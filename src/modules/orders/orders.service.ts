import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  buildSkipTake,
  buildPageMeta,
} from '../../common/utils/pagination.util';
import { toInclusiveEndOfDay } from '../../common/utils/date.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

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
}
