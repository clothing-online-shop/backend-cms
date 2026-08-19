import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentStatus,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { toSafeUser } from '../../common/utils/safe-user.util';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import {
  buildSkipTake,
  buildPageMeta,
} from '../../common/utils/pagination.util';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string;
  role?: UserRole;
}

const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(input: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        password: input.passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        role: input.role ?? UserRole.CUSTOMER,
      },
    });
  }

  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });
  }

  async findAllCustomers(query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.UserWhereInput = { role: UserRole.CUSTOMER };
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...buildSkipTake(page, limit),
        include: { _count: { select: { orders: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);

    const totalSpentByUserId = await this.getTotalSpentByUserId(
      customers.map((c) => c.id),
    );

    return {
      data: customers.map((c) => toCustomerListItem(c, totalSpentByUserId)),
      meta: buildPageMeta(total, page, limit),
    };
  }

  async findCustomerDetail(id: string) {
    const customer = await this.prisma.user.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        },
      },
    });
    if (!customer || customer.role !== UserRole.CUSTOMER) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    const totalOrders = customer.orders.length;
    const totalSpent = customer.orders
      .filter((o) => o.paymentStatus === PaymentStatus.PAID)
      .reduce((sum, o) => sum + o.totalAmount.toNumber(), 0);

    const { orders, ...rest } = customer;
    return {
      ...toSafeUser(rest),
      totalOrders,
      totalSpent,
      orders: orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        paymentStatus: o.paymentStatus,
        totalAmount: o.totalAmount.toNumber(),
        createdAt: o.createdAt,
        itemCount: o.items.length,
      })),
    };
  }

  async updateStatus(
    id: string,
    status: UserStatus,
  ): Promise<Omit<User, 'password'>> {
    const customer = await this.prisma.user.findUnique({ where: { id } });
    if (!customer || customer.role !== UserRole.CUSTOMER) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status },
    });
    return toSafeUser(updated);
  }

  // Chỉ tính đơn PAID — đơn chưa thanh toán/đã hoàn tiền không tính là "đã mua", khớp cách
  // findAllSortedByBestSelling() ở products.service.ts chỉ tính đơn COMPLETED cho "bán chạy".
  private async getTotalSpentByUserId(
    userIds: string[],
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const grouped = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, paymentStatus: PaymentStatus.PAID },
      _sum: { totalAmount: true },
    });

    return new Map(
      grouped.map((g) => [g.userId, g._sum.totalAmount?.toNumber() ?? 0]),
    );
  }
}

function toCustomerListItem(
  customer: User & { _count: { orders: number } },
  totalSpentByUserId: Map<string, number>,
) {
  const { _count, ...rest } = customer;
  return {
    ...toSafeUser(rest),
    totalOrders: _count.orders,
    totalSpent: totalSpentByUserId.get(customer.id) ?? 0,
  };
}
