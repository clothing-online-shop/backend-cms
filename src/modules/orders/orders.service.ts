import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  StockMovementType,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  buildSkipTake,
  buildPageMeta,
} from '../../common/utils/pagination.util';
import {
  toInclusiveEndOfDay,
  toInclusiveStartOfDay,
} from '../../common/utils/date.util';
import { applyStockMovement } from '../../common/utils/stock-movement.util';
import { updateOrderIfUnchanged } from '../../common/utils/optimistic-update.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

// Luật chuyển trạng thái hợp lệ — PENDING→CONFIRMED→PACKING→HANDED_OVER→SHIPPING→COMPLETED
// tuần tự, không nhảy cóc/lùi; CANCELLED cho phép từ MỌI trạng thái kể cả SHIPPING (đơn vị
// vận chuyển giao thất bại/khách từ chối nhận vẫn cần hủy được). Vì vậy hoàn kho lúc hủy
// (xem shouldRestock bên dưới) KHÔNG áp dụng cho case hủy từ SHIPPING — hàng đang ở đơn vị
// vận chuyển, chưa chắc đã về lại kho vật lý. COMPLETED/CANCELLED là trạng thái cuối, không
// đổi tiếp được.
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
        query.from
          ? { createdAt: { gte: toInclusiveStartOfDay(query.from) } }
          : {},
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

    this.assertValidTransition(order, dto);
    const effects = this.deriveUpdateEffects(order, dto.status);

    await this.prisma.$transaction(async (tx) => {
      if (effects.shouldRestock) {
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

      // where kèm status cũ — optimistic concurrency (xem updateOrderIfUnchanged): 1
      // request khác đổi status của đúng đơn này xen giữa lúc đọc order ở trên và
      // transaction này chạy thì rollback toàn bộ (kể cả phần hoàn kho vừa ghi) thay vì âm
      // thầm đổi đè lên 1 trạng thái đã stale.
      await updateOrderIfUnchanged(
        tx,
        { id, status: order.status },
        {
          status: dto.status,
          ...(effects.shouldMarkPaid
            ? { paymentStatus: PaymentStatus.PAID }
            : {}),
          ...(effects.shouldRevertPayment
            ? { paymentStatus: PaymentStatus.REFUNDED }
            : {}),
        },
      );

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

  // Gộp 3 điều kiện chặn của updateStatus() vào 1 chỗ để đọc luồng chính (đo hiệu ứng phụ +
  // ghi transaction) không bị chen ngang bởi các early-throw — mỗi rule vẫn giữ đúng
  // message/code riêng, chỉ tách khỏi thân hàm chính.
  private assertValidTransition(
    order: {
      status: OrderStatus;
      paymentMethod: string;
      paymentStatus: PaymentStatus;
    },
    dto: UpdateOrderStatusDto,
  ): void {
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

    // Không cho hoàn tất (giao xong) 1 đơn online (VNPAY/MOMO/STRIPE/BANK_TRANSFER) mà hệ
    // thống chưa ghi nhận đã thu tiền — thiếu chặn này thì đơn có thể đi hết luồng
    // CONFIRMED→...→COMPLETED mà không ai gọi xác nhận thanh toán, giao hàng xong nhưng
    // paymentStatus vẫn UNPAID. COD không cần check vì deriveUpdateEffects() tự đánh dấu
    // PAID đúng lúc hoàn tất.
    if (
      dto.status === OrderStatus.COMPLETED &&
      order.paymentMethod !== 'COD' &&
      order.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new BadRequestException({
        message: 'Đơn hàng chưa được xác nhận thanh toán, không thể hoàn tất.',
        code: ErrorCode.ORDER_COMPLETE_REQUIRES_PAYMENT,
      });
    }
  }

  // 3 hiệu ứng phụ tự động của 1 lần đổi trạng thái — tách khỏi updateStatus() để đọc riêng
  // từng luật mà không phải lội qua phần validate/transaction xung quanh.
  private deriveUpdateEffects(
    order: {
      status: OrderStatus;
      paymentMethod: string;
      paymentStatus: PaymentStatus;
    },
    nextStatus: OrderStatus,
  ): {
    shouldRestock: boolean;
    shouldMarkPaid: boolean;
    shouldRevertPayment: boolean;
  } {
    return {
      // Hoàn lại đúng số lượng đã trừ lúc tạo đơn — đơn hủy không nên giữ hàng "mất tích"
      // trong kho, admin bán lại được ngay. Không lọc theo Product.isDelete (khác
      // InventoryService.lockVariant()): hoàn kho là sửa đúng số tồn vật lý, không liên
      // quan gì tới sản phẩm còn hiển thị trên catalog hay không. TRỪ hủy từ SHIPPING (xem
      // comment ORDER_STATUS_TRANSITIONS ở đầu file) — hàng đang ở đơn vị vận chuyển, chưa
      // chắc đã về lại kho vật lý, tự hoàn kho lúc này sẽ ghi khống tồn kho không có thật.
      shouldRestock:
        nextStatus === OrderStatus.CANCELLED &&
        order.status !== OrderStatus.SHIPPING,
      // Chỉ áp dụng cho COD — các phương thức online (VNPAY/MOMO/STRIPE) chưa tích hợp
      // cổng thanh toán thật nên hệ thống không có cách nào tự biết đã thu tiền hay chưa.
      shouldMarkPaid:
        nextStatus === OrderStatus.COMPLETED && order.paymentMethod === 'COD',
      // Đơn đã thu tiền (PAID) mà bị hủy — chuyển sang REFUNDED thay vì để nguyên PAID mãi
      // mãi, không thì totalSpent/doanh thu (xem UsersService.getTotalSpentByUserId) tính
      // khống tiền cho 1 đơn đã hủy. Đây chỉ là đổi trạng thái ghi nhận "cần hoàn tiền",
      // không tự động hoàn tiền qua cổng thanh toán — việc đó nằm ngoài phạm vi hệ thống
      // hiện tại.
      shouldRevertPayment:
        nextStatus === OrderStatus.CANCELLED &&
        order.paymentStatus === PaymentStatus.PAID,
    };
  }

  // Chỉ áp dụng cho đơn chuyển khoản — VNPay/COD có luồng cập nhật trạng thái riêng của
  // chúng (VNPay qua IPN ở backend-user, COD qua giao hàng, cả 2 không thuộc phạm vi
  // module này). Đây là hành động thủ công duy nhất admin cần cho luồng chuyển khoản: xác
  // nhận đã nhận tiền.
  async confirmBankTransfer(id: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException({
        message: 'Không tìm thấy đơn hàng.',
        code: ErrorCode.ORDER_NOT_FOUND,
      });
    }
    if (order.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException({
        message: 'Đơn hàng này không phải thanh toán chuyển khoản.',
        code: ErrorCode.ORDER_NOT_BANK_TRANSFER,
      });
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException({
        message: 'Đơn hàng đã được xác nhận thanh toán trước đó.',
        code: ErrorCode.ORDER_ALREADY_PAID,
      });
    }
    // Đơn đã hủy thì không "hồi sinh" — thiếu check này, xác nhận thanh toán muộn cho 1 đơn
    // đã CANCELLED sẽ ghi đè status về CONFIRMED, trong khi CANCELLED được thiết kế là trạng
    // thái cuối (xem ORDER_STATUS_TRANSITIONS).
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException({
        message: 'Đơn hàng đã bị hủy, không thể xác nhận thanh toán.',
        code: ErrorCode.ORDER_CANCELLED_CANNOT_PAY,
      });
    }

    // Chỉ đẩy status sang CONFIRMED nếu đơn đang PENDING (luồng bình thường: đơn mới tạo,
    // admin xác nhận đã nhận tiền). Nếu đơn đã được đẩy qua trạng thái khác (PACKING trở
    // lên) bằng updateStatus() trước khi admin kịp xác nhận thanh toán, giữ nguyên status
    // hiện tại — không kéo lùi lại CONFIRMED (tránh đảo ngược tiến trình đã đi).
    const willTransitionStatus = order.status === OrderStatus.PENDING;
    const nextStatus = willTransitionStatus
      ? OrderStatus.CONFIRMED
      : order.status;

    await this.prisma.$transaction(async (tx) => {
      // where kèm CẢ paymentStatus lẫn status cũ (không chỉ paymentStatus) — thiếu `status`
      // ở đây từng là 1 lỗ hổng thật: nếu 1 request khác hủy đơn (đổi status) đúng lúc
      // request này đang chạy, where chỉ khớp paymentStatus vẫn "trúng" và ghi đè status
      // trở lại `nextStatus`, âm thầm hồi sinh 1 đơn vừa bị hủy. Dùng chung
      // updateOrderIfUnchanged với updateStatus() để 2 nơi không lệch nhau nữa.
      await updateOrderIfUnchanged(
        tx,
        { id, status: order.status, paymentStatus: order.paymentStatus },
        { paymentStatus: PaymentStatus.PAID, status: nextStatus },
      );

      await tx.paymentTransaction.create({
        data: {
          orderId: id,
          provider: PaymentProvider.BANK_TRANSFER,
          amount: order.totalAmount,
          status: TransactionStatus.SUCCESS,
        },
      });

      // Luôn ghi lịch sử, kể cả khi xác nhận muộn (đơn đã ở PACKING trở lên, status không
      // đổi) — trước đây chỉ ghi khi willTransitionStatus, khiến 1 lần xác nhận thanh toán
      // muộn hoàn toàn vô hình trên tab "Lịch sử trạng thái" ở OrderDetail.tsx (chỉ
      // PaymentTransaction có dấu vết, nhưng findOne() không surface bảng đó ra FE).
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: nextStatus,
          note: willTransitionStatus
            ? 'Xác nhận đã nhận thanh toán chuyển khoản.'
            : `Xác nhận đã nhận thanh toán chuyển khoản (đơn đang ở trạng thái ${order.status}).`,
          changedById: userId,
        },
      });
    });

    if (willTransitionStatus) {
      this.notifyCustomerStatusChange(order.orderCode, nextStatus, null);
    }

    // findOne() (không phải trả thẳng bản ghi Order thô) — khớp đúng shape response với
    // updateStatus(), 2 API cùng nhóm "đổi trạng thái đơn" nên FE dùng lại được 1 kiểu dữ
    // liệu, không phải phân biệt "gọi từ đâu ra thì thiếu field nào".
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
