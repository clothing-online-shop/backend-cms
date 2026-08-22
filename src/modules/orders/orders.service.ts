import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

// Luật chuyển trạng thái hợp lệ — PENDING→CONFIRMED→SHIPPING→COMPLETED tuần tự, không
// nhảy cóc/lùi; CANCELLED cho phép từ 3 trạng thái đầu (chưa giao thì còn hủy được).
// COMPLETED/CANCELLED là trạng thái cuối, không đổi tiếp được.
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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
        include: { _count: { select: { items: true } } },
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
        itemCount: order._count.items,
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

    return this.findOne(id);
  }
}
