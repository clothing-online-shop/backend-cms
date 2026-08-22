import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    user: { fullName: 'Nguyễn Văn A' },
    statusHistories: [],
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
        customerName: 'Nguyễn Văn A',
        itemCount: 2,
        cancelReason: null,
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

  it('đơn đã hủy → trả đúng lý do hủy từ statusHistories', async () => {
    const { prisma, transaction } = createPrismaMock();
    transaction.mockResolvedValue([
      [
        order({
          status: 'CANCELLED',
          statusHistories: [{ note: 'Khách đổi ý, không muốn mua nữa.' }],
        }),
      ],
      1,
    ]);
    const service = new OrdersService(prisma);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data[0].cancelReason).toBe(
      'Khách đổi ý, không muốn mua nữa.',
    );
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

describe('OrdersService.findOne', () => {
  function createDetailPrismaMock() {
    const findUnique = jest.fn();
    const prisma = {
      order: { findUnique },
    } as unknown as PrismaService;
    return { prisma, findUnique };
  }

  function orderDetail(overrides: Partial<Record<string, unknown>> = {}) {
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
      updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      user: {
        id: 'user-1',
        fullName: 'Nguyễn Văn A',
        email: 'a@example.com',
        phone: '0900000000',
      },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          productName: 'Áo thun basic',
          variantSku: 'SKU-1',
          size: 'M',
          color: 'Đen',
          thumbnail: null,
          quantity: 2,
          priceAtPurchase: new Prisma.Decimal(150000),
        },
      ],
      statusHistories: [
        {
          id: 'history-1',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          changedBy: null,
          createdAt: new Date('2026-08-21T00:00:00.000Z'),
        },
        {
          id: 'history-2',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          note: 'Đã xác nhận qua điện thoại',
          changedBy: { fullName: 'Quản trị viên' },
          createdAt: new Date('2026-08-21T01:00:00.000Z'),
        },
      ],
      ...overrides,
    };
  }

  it('trả về đủ order + items + customer + statusHistories, Decimal đã ép sang number', async () => {
    const { prisma, findUnique } = createDetailPrismaMock();
    findUnique.mockResolvedValue(orderDetail());
    const service = new OrdersService(prisma);

    const result = await service.findOne('order-1');

    expect(result).toEqual({
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      totalAmount: 300000,
      shippingAddress:
        'Nguyễn Văn A - 0900000000 - 123 Đường ABC, Phường 1, Quận 1, TP. Hồ Chí Minh',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      customer: {
        id: 'user-1',
        fullName: 'Nguyễn Văn A',
        email: 'a@example.com',
        phone: '0900000000',
      },
      items: [
        {
          id: 'item-1',
          productVariantId: 'variant-1',
          productName: 'Áo thun basic',
          variantSku: 'SKU-1',
          size: 'M',
          color: 'Đen',
          thumbnail: null,
          quantity: 2,
          priceAtPurchase: 150000,
        },
      ],
      statusHistories: [
        {
          id: 'history-1',
          fromStatus: null,
          toStatus: 'PENDING',
          note: null,
          changedByName: null,
          createdAt: new Date('2026-08-21T00:00:00.000Z'),
        },
        {
          id: 'history-2',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          note: 'Đã xác nhận qua điện thoại',
          changedByName: 'Quản trị viên',
          createdAt: new Date('2026-08-21T01:00:00.000Z'),
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } }),
    );
  });

  it('order không tồn tại → NotFoundException kèm code ORDER_NOT_FOUND', async () => {
    const { prisma, findUnique } = createDetailPrismaMock();
    findUnique.mockResolvedValue(null);
    const service = new OrdersService(prisma);

    let caught: NotFoundException | undefined;
    try {
      await service.findOne('missing');
    } catch (err) {
      caught = err as NotFoundException;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect(caught?.getResponse()).toMatchObject({
      message: 'Không tìm thấy đơn hàng.',
      code: 1801,
    });
  });
});

describe('OrdersService.updateStatus', () => {
  function createUpdateStatusPrismaMock() {
    const orderFindUnique = jest.fn();
    const orderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const stockMovementCreate = jest.fn();
    const productVariantUpdate = jest.fn();
    const orderStatusHistoryCreate = jest.fn();
    const tx = {
      order: { updateMany: orderUpdateMany },
      stockMovement: { create: stockMovementCreate },
      productVariant: { update: productVariantUpdate },
      orderStatusHistory: { create: orderStatusHistoryCreate },
    };
    const transaction = jest.fn(
      (cb: (tx: unknown) => unknown) => cb(tx) as Promise<unknown>,
    );
    const prisma = {
      order: { findUnique: orderFindUnique },
      $transaction: transaction,
    } as unknown as PrismaService;
    return {
      prisma,
      orderFindUnique,
      orderUpdateMany,
      stockMovementCreate,
      productVariantUpdate,
      orderStatusHistoryCreate,
      transaction,
    };
  }

  // Bản ghi tối thiểu findOne() (lệnh gọi thứ 2, sau khi transaction commit) cần để không
  // throw khi map — không đại diện dữ liệu thật, chỉ đủ field để .map() không crash.
  function minimalFindOneRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      totalAmount: new Prisma.Decimal(150000),
      shippingAddress: 'A',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'user-1',
        fullName: 'A',
        email: 'a@example.com',
        phone: null,
      },
      items: [],
      statusHistories: [],
      ...overrides,
    };
  }

  it('PENDING → CONFIRMED: cập nhật status, ghi lịch sử, không đụng tồn kho/paymentStatus', async () => {
    const {
      prisma,
      orderFindUnique,
      orderUpdateMany,
      stockMovementCreate,
      orderStatusHistoryCreate,
    } = createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'PENDING',
        paymentMethod: 'COD',
        items: [],
      })
      .mockResolvedValueOnce(minimalFindOneRow());
    const service = new OrdersService(prisma);

    await service.updateStatus('order-1', { status: 'CONFIRMED' }, 'admin-1');

    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    expect(orderStatusHistoryCreate).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        note: null,
        changedById: 'admin-1',
      },
    });
  });

  it('→ CANCELLED: hoàn kho đúng số lượng từng item', async () => {
    const {
      prisma,
      orderFindUnique,
      stockMovementCreate,
      productVariantUpdate,
    } = createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'PENDING',
        paymentMethod: 'COD',
        items: [
          { productVariantId: 'variant-1', quantity: 2 },
          { productVariantId: 'variant-2', quantity: 1 },
        ],
      })
      .mockResolvedValueOnce(minimalFindOneRow({ status: 'CANCELLED' }));
    const service = new OrdersService(prisma);

    await service.updateStatus('order-1', { status: 'CANCELLED' }, 'admin-1');

    expect(stockMovementCreate).toHaveBeenCalledTimes(2);
    const expectedFirstMovementData = expect.objectContaining({
      productVariantId: 'variant-1',
      type: 'IMPORT',
      quantity: 2,
    }) as unknown as Record<string, unknown>;
    expect(stockMovementCreate).toHaveBeenCalledWith({
      data: expectedFirstMovementData,
    });
    expect(productVariantUpdate).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: { stockQuantity: { increment: 2 } },
    });
    expect(productVariantUpdate).toHaveBeenCalledWith({
      where: { id: 'variant-2' },
      data: { stockQuantity: { increment: 1 } },
    });
  });

  it('SHIPPING → COMPLETED cho đơn COD: tự động paymentStatus = PAID', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'SHIPPING',
        paymentMethod: 'COD',
        items: [],
      })
      .mockResolvedValueOnce(
        minimalFindOneRow({ status: 'COMPLETED', paymentStatus: 'PAID' }),
      );
    const service = new OrdersService(prisma);

    await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'SHIPPING' },
      data: { status: 'COMPLETED', paymentStatus: 'PAID' },
    });
  });

  it('SHIPPING → COMPLETED cho đơn VNPAY: KHÔNG tự đổi paymentStatus', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'SHIPPING',
        paymentMethod: 'VNPAY',
        items: [],
      })
      .mockResolvedValueOnce(
        minimalFindOneRow({ status: 'COMPLETED', paymentMethod: 'VNPAY' }),
      );
    const service = new OrdersService(prisma);

    await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'SHIPPING' },
      data: { status: 'COMPLETED' },
    });
  });

  it('chuyển sai luật (PENDING → COMPLETED) → BadRequestException kèm code ORDER_INVALID_STATUS_TRANSITION', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValueOnce({
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'PENDING',
      paymentMethod: 'COD',
      items: [],
    });
    const service = new OrdersService(prisma);

    let caught: BadRequestException | undefined;
    try {
      await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 1802 });
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('order không tồn tại → NotFoundException', async () => {
    const { prisma, orderFindUnique } = createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValueOnce(null);
    const service = new OrdersService(prisma);

    await expect(
      service.updateStatus('missing', { status: 'CONFIRMED' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bị đổi trạng thái đồng thời (updateMany count=0) → ConflictException', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValueOnce({
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'PENDING',
      paymentMethod: 'COD',
      items: [],
    });
    orderUpdateMany.mockResolvedValue({ count: 0 });
    const service = new OrdersService(prisma);

    await expect(
      service.updateStatus('order-1', { status: 'CONFIRMED' }, 'admin-1'),
    ).rejects.toThrow(
      'Đơn hàng vừa được cập nhật bởi thao tác khác, vui lòng thử lại.',
    );
  });
});
