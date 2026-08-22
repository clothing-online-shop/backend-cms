import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  buildSkipTake,
  buildPageMeta,
} from '../../common/utils/pagination.util';
import { toInclusiveEndOfDay } from '../../common/utils/date.util';
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
}
