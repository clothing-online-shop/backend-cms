import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  buildSkipTake,
  buildPageMeta,
} from '../../common/utils/pagination.util';
import { toInclusiveEndOfDay } from '../../common/utils/date.util';
import { applyStockMovement } from '../../common/utils/stock-movement.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

// Luật chuyển trạng thái hợp lệ — PENDING→CONFIRMED→PACKING→HANDED_OVER→SHIPPING→COMPLETED
// tuần tự, không nhảy cóc/lùi; CANCELLED cho phép từ mọi trạng thái trước SHIPPING (chưa bắt
// đầu giao thì còn hủy được). COMPLETED/CANCELLED là trạng thái cuối, không đổi tiếp được.
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
  [OrderStatus.PACKING]: [OrderStatus.HANDED_OVER, OrderStatus.CANCELLED],
  [OrderStatus.HANDED_OVER]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.OrderWhereInput = {
      AND: [
        query.status ? { status: query.status } : {},
        query.paymentMethod ? { paymentMethod: query.paymentMethod } : {},
        query.from ? { createdAt: { gte: new Date(query.from) } } : {},
        query.to ? { createdAt: { lte: toInclusiveEndOfDay(query.to) } } : {},
        // orderCode và SĐT khách (nằm trong chuỗi shippingAddress, không có field
        // riêng — xem Order.shippingAddress trong schema.prisma) cùng 1 ô search, khớp
        // 1 trong 2 là đủ, để admin không cần biết trước đang gõ mã đơn hay SĐT.
        query.search
          ? {
              OR: [
                { orderCode: { contains: query.search, mode: 'insensitive' } },
                { shippingAddress: { contains: query.search } },
              ],
            }
          : {},
      ],
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          _count: { select: { items: true } },
          user: { select: { fullName: true } },
          // Chỉ đơn CANCELLED mới có dòng khớp — order chưa từng hủy thì mảng rỗng, map
          // bên dưới tự trả null. take: 1 vì 1 đơn chỉ hủy được đúng 1 lần (CANCELLED là
          // trạng thái cuối, không hủy lại được nữa — xem ORDER_STATUS_TRANSITIONS).
          statusHistories: {
            where: { toStatus: OrderStatus.CANCELLED },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { note: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...buildSkipTake(page, limit),
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((order) => ({
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount.toNumber(),
        shippingAddress: order.shippingAddress,
        customerName: order.user.fullName,
        itemCount: order._count.items,
        cancelReason: order.statusHistories[0]?.note ?? null,
        createdAt: order.createdAt,
      })),
      meta: buildPageMeta(total, page, limit),
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        // asc — hiển thị theo đúng thứ tự diễn ra (tạo đơn trước, các lần đổi trạng thái
        // sau), khác findAll() (không cần thứ tự vì chỉ đếm _count.items).
        statusHistories: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: { fullName: true } } },
        },
        user: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Không tìm thấy đơn hàng.',
        code: ErrorCode.ORDER_NOT_FOUND,
      });
    }

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount.toNumber(),
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customer: order.user,
      items: order.items.map((item) => ({
        id: item.id,
        productVariantId: item.productVariantId,
        productName: item.productName,
        variantSku: item.variantSku,
        size: item.size,
        color: item.color,
        thumbnail: item.thumbnail,
        quantity: item.quantity,
        priceAtPurchase: item.priceAtPurchase.toNumber(),
      })),
      statusHistories: order.statusHistories.map((history) => ({
        id: history.id,
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        note: history.note,
        // null = hệ thống tự ghi (vd lúc tạo đơn) — xem comment OrderStatusHistory.changedById
        // trong schema.prisma, không phải lỗi thiếu dữ liệu.
        changedByName: history.changedBy?.fullName ?? null,
        createdAt: history.createdAt,
      })),
    };
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException({
        message: 'Không tìm thấy đơn hàng.',
        code: ErrorCode.ORDER_NOT_FOUND,
      });
    }

    if (!ORDER_STATUS_TRANSITIONS[order.status].includes(dto.status)) {
      throw new BadRequestException({
        message: `Không thể chuyển đơn từ trạng thái "${order.status}" sang "${dto.status}".`,
        code: ErrorCode.ORDER_INVALID_STATUS_TRANSITION,
      });
    }

    // FE chỉ bắt buộc nhập lý do khi hủy đơn ở phía client (validate UX) — API vẫn phải tự
    // ràng buộc lại, không thì client khác (Swagger, script...) hủy đơn thẳng qua API mà
    // không ghi lý do, hỏng luôn mục đích của cột "Lý do hủy" ở màn danh sách.
    if (dto.status === OrderStatus.CANCELLED && !dto.note?.trim()) {
      throw new BadRequestException({
        message: 'Vui lòng nhập lý do khi hủy đơn.',
        code: ErrorCode.ORDER_CANCEL_REASON_REQUIRED,
      });
    }

    // Hoàn lại đúng số lượng đã trừ lúc tạo đơn — đơn hủy không nên giữ hàng "mất tích"
    // trong kho, admin bán lại được ngay. Không lọc theo Product.isDelete (khác
    // InventoryService.lockVariant()): hoàn kho là sửa đúng số tồn vật lý, không liên quan
    // gì tới sản phẩm còn hiển thị trên catalog hay không.
    const shouldRestock = dto.status === OrderStatus.CANCELLED;
    // Chỉ áp dụng cho COD — các phương thức online (VNPAY/MOMO/STRIPE) chưa tích hợp cổng
    // thanh toán thật nên hệ thống không có cách nào tự biết đã thu tiền hay chưa (xem
    // paymentMethodLabel()/quyết định lúc làm tính năng chọn phương thức thanh toán).
    const shouldMarkPaid =
      dto.status === OrderStatus.COMPLETED && order.paymentMethod === 'COD';

    await this.prisma.$transaction(async (tx) => {
      if (shouldRestock) {
        for (const item of order.items) {
          await applyStockMovement(tx, {
            variantId: item.productVariantId,
            type: StockMovementType.IMPORT,
            delta: item.quantity,
            note: `Hoàn kho do hủy đơn ${order.orderCode}`,
            createdById: userId,
          });
        }
      }

      // updateMany + where kèm status cũ (thay vì update thẳng theo id) — optimistic
      // concurrency: nếu 1 request khác đã đổi status của đúng đơn này xen giữa lúc đọc
      // order ở trên và transaction này chạy, count trả về 0, rollback toàn bộ (kể cả phần
      // hoàn kho vừa ghi) thay vì âm thầm đổi đè lên 1 trạng thái đã stale.
      const updated = await tx.order.updateMany({
        where: { id, status: order.status },
        data: {
          status: dto.status,
          ...(shouldMarkPaid ? { paymentStatus: PaymentStatus.PAID } : {}),
        },
      });
      if (updated.count === 0) {
        throw new ConflictException(
          'Đơn hàng vừa được cập nhật bởi thao tác khác, vui lòng thử lại.',
        );
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: dto.status,
          note: dto.note ?? null,
          changedById: userId,
        },
      });
    });

    this.notifyCustomerStatusChange(
      order.orderCode,
      dto.status,
      dto.note ?? null,
    );

    return this.findOne(id);
  }

  // Báo khách hàng qua email mỗi lần đổi trạng thái — gọi API nội bộ ở backend-user (nơi
  // duy nhất có MailService/SMTP đã cấu hình, tránh trùng lặp thiết lập mail ở cả 2 backend).
  // KHÔNG await: lỗi mạng/SMTP không được phép làm hỏng response PATCH status — đây chỉ là
  // tác vụ phụ, không phải luồng nghiệp vụ chính (đổi trạng thái đơn). Không retry ở bản đầu.
  private notifyCustomerStatusChange(
    orderCode: string,
    status: OrderStatus,
    note: string | null,
  ): void {
    const internalKey = this.config.get<string>('INTERNAL_NOTIFY_KEY');
    if (!internalKey) {
      this.logger.warn(
        'Thiếu INTERNAL_NOTIFY_KEY trong .env — bỏ qua gửi email thông báo đổi trạng thái đơn.',
      );
      return;
    }
    const baseUrl = this.config.get<string>(
      'BACKEND_USER_BASE_URL',
      'http://localhost:3001',
    );

    fetch(`${baseUrl}/internal/orders/${orderCode}/status-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': internalKey,
      },
      body: JSON.stringify({ status, note }),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.error(
            `Gửi thông báo đổi trạng thái đơn ${orderCode} thất bại: HTTP ${res.status}`,
          );
        }
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Gửi thông báo đổi trạng thái đơn ${orderCode} thất bại: ${String(err)}`,
        );
      });
  }
}
