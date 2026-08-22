import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../config/prisma.service';

function createPrismaMock() {
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    order: { findMany, count },
  } as unknown as PrismaService;
  return { prisma, transaction, findMany, count };
}

function order(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    orderCode: 'DH20260821ABCDEF',
    status: 'PENDING',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    totalAmount: new Prisma.Decimal(300000),
    shippingAddress:
      'Nguyễn Văn A - 0900000000 - 123 Đường ABC, Phường 1, Quận 1, TP. Hồ Chí Minh',
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    _count: { items: 2 },
    ...overrides,
  };
}

describe('OrdersService.findAll', () => {
  it('maps order fields into the summary response shape', async () => {
    const { prisma, transaction } = createPrismaMock();
    transaction.mockResolvedValue([[order()], 1]);
    const service = new OrdersService(prisma);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data).toEqual([
      {
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'PENDING',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        totalAmount: 300000,
        shippingAddress:
          'Nguyễn Văn A - 0900000000 - 123 Đường ABC, Phường 1, Quận 1, TP. Hồ Chí Minh',
        itemCount: 2,
        createdAt: order().createdAt,
      },
    ]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('leaves the filters out of the where clause when no filter is given', async () => {
    const { prisma, transaction, findMany, count } = createPrismaMock();
    let capturedFindManyWhere: Prisma.OrderWhereInput | undefined;
    findMany.mockImplementation((args: { where: Prisma.OrderWhereInput }) => {
      capturedFindManyWhere = args.where;
      return Promise.resolve([]);
    });
    count.mockResolvedValue(0);
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );

    const service = new OrdersService(prisma);
    await service.findAll({ page: 1, limit: 20 });

    const andConditions = capturedFindManyWhere?.AND as
      Prisma.OrderWhereInput[] | undefined;
    expect(andConditions).toEqual([{}, {}, {}, {}, {}]);
  });

  it('adds every filter to the where clause passed to findMany and count', async () => {
    const { prisma, transaction, findMany, count } = createPrismaMock();
    let capturedFindManyWhere: Prisma.OrderWhereInput | undefined;
    let capturedCountWhere: Prisma.OrderWhereInput | undefined;
    findMany.mockImplementation((args: { where: Prisma.OrderWhereInput }) => {
      capturedFindManyWhere = args.where;
      return Promise.resolve([]);
    });
    count.mockImplementation((args: { where: Prisma.OrderWhereInput }) => {
      capturedCountWhere = args.where;
      return Promise.resolve(0);
    });
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );

    const service = new OrdersService(prisma);
    await service.findAll({
      status: 'CONFIRMED',
      paymentMethod: 'VNPAY',
      from: '2026-08-01',
      to: '2026-08-21',
      page: 1,
      limit: 20,
    });

    const andConditions = capturedFindManyWhere?.AND as
      Prisma.OrderWhereInput[] | undefined;
    expect(andConditions).toContainEqual({ status: 'CONFIRMED' });
    expect(andConditions).toContainEqual({ paymentMethod: 'VNPAY' });
    expect(andConditions).toContainEqual({
      createdAt: { gte: new Date('2026-08-01') },
    });
    const toCondition = andConditions?.find((item) => {
      const createdAt = (item as Record<string, unknown>).createdAt as
        { lte?: Date } | undefined;
      return createdAt?.lte !== undefined;
    }) as { createdAt: { lte: Date } } | undefined;
    expect(toCondition?.createdAt.lte.getFullYear()).toBe(2026);
    expect(toCondition?.createdAt.lte.getHours()).toBe(23);
    expect(toCondition?.createdAt.lte.getMinutes()).toBe(59);
    expect(capturedCountWhere).toEqual(capturedFindManyWhere);
  });

  it('search khớp cả orderCode (contains, không phân biệt hoa thường) và SĐT trong shippingAddress', async () => {
    const { prisma, transaction, findMany, count } = createPrismaMock();
    let capturedFindManyWhere: Prisma.OrderWhereInput | undefined;
    findMany.mockImplementation((args: { where: Prisma.OrderWhereInput }) => {
      capturedFindManyWhere = args.where;
      return Promise.resolve([]);
    });
    count.mockResolvedValue(0);
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );

    const service = new OrdersService(prisma);
    await service.findAll({ search: '0900000000', page: 1, limit: 20 });

    const andConditions = capturedFindManyWhere?.AND as
      Prisma.OrderWhereInput[] | undefined;
    expect(andConditions).toContainEqual({
      OR: [
        { orderCode: { contains: '0900000000', mode: 'insensitive' } },
        { shippingAddress: { contains: '0900000000' } },
      ],
    });
  });

  it('phân trang: dùng đúng skip/take theo page/limit', async () => {
    const { prisma, transaction, findMany, count } = createPrismaMock();
    let capturedSkip: number | undefined;
    let capturedTake: number | undefined;
    findMany.mockImplementation((args: { skip: number; take: number }) => {
      capturedSkip = args.skip;
      capturedTake = args.take;
      return Promise.resolve([]);
    });
    count.mockResolvedValue(45);
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );

    const service = new OrdersService(prisma);
    const result = await service.findAll({ page: 3, limit: 10 });

    expect(capturedSkip).toBe(20);
    expect(capturedTake).toBe(10);
    expect(result.meta).toEqual({
      total: 45,
      page: 3,
      limit: 10,
      totalPages: 5,
    });
  });
});
