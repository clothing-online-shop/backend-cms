import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../config/prisma.service';

// Stub tối giản — hầu hết test không cần INTERNAL_NOTIFY_KEY (notifyCustomerStatusChange tự
// no-op khi thiếu key, xem orders.service.ts), chỉ test riêng cho gửi thông báo mới cần
// truyền overrides.
function fakeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => overrides[key] ?? defaultValue,
  } as unknown as ConfigService;
}

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
    const service = new OrdersService(prisma, fakeConfig());

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
    const service = new OrdersService(prisma, fakeConfig());

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

    const service = new OrdersService(prisma, fakeConfig());
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

    const service = new OrdersService(prisma, fakeConfig());
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
    const fromCondition = andConditions?.find((item) => {
      const createdAt = (item as Record<string, unknown>).createdAt as
        { gte?: Date } | undefined;
      return createdAt?.gte !== undefined;
    }) as { createdAt: { gte: Date } } | undefined;
    const toCondition = andConditions?.find((item) => {
      const createdAt = (item as Record<string, unknown>).createdAt as
        { lte?: Date } | undefined;
      return createdAt?.lte !== undefined;
    }) as { createdAt: { lte: Date } } | undefined;
    // So bằng toISOString() (UTC tuyệt đối, không phụ thuộc TZ máy chạy test) — gte/lte phải
    // neo theo giờ VN tường minh (xem toInclusiveStartOfDay()/toInclusiveEndOfDay() trong
    // date.util.ts), không phải giờ local của máy/server chạy code, nếu không 2 đầu mút
    // from/to của cùng 1 khoảng lọc sẽ lệch múi giờ nhau trên server không đặt TZ=VN.
    expect(fromCondition?.createdAt.gte.toISOString()).toBe(
      '2026-07-31T17:00:00.000Z',
    );
    expect(toCondition?.createdAt.lte.toISOString()).toBe(
      '2026-08-21T16:59:59.999Z',
    );
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

    const service = new OrdersService(prisma, fakeConfig());
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

    const service = new OrdersService(prisma, fakeConfig());
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
    const service = new OrdersService(prisma, fakeConfig());

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
    const service = new OrdersService(prisma, fakeConfig());

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

// Bản ghi tối thiểu findOne() cần để không throw khi map (.items/.statusHistories) — dùng
// chung giữa OrdersService.updateStatus (lệnh gọi thứ 2, sau khi transaction commit) và
// OrdersService.confirmBankTransfer (findOne() gọi lại sau khi đổi paymentStatus). Không đại
// diện dữ liệu thật, chỉ đủ field để .map() không crash.
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
    const service = new OrdersService(prisma, fakeConfig());

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
    const service = new OrdersService(prisma, fakeConfig());

    await service.updateStatus(
      'order-1',
      { status: 'CANCELLED', note: 'Khách đổi ý không mua nữa' },
      'admin-1',
    );

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

  it('SHIPPING → CANCELLED: KHÔNG tự hoàn kho (hàng đang ở đơn vị vận chuyển)', async () => {
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
        status: 'SHIPPING',
        paymentMethod: 'COD',
        items: [{ productVariantId: 'variant-1', quantity: 2 }],
      })
      .mockResolvedValueOnce(minimalFindOneRow({ status: 'CANCELLED' }));
    const service = new OrdersService(prisma, fakeConfig());

    await service.updateStatus(
      'order-1',
      { status: 'CANCELLED', note: 'Khách từ chối nhận hàng' },
      'admin-1',
    );

    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(productVariantUpdate).not.toHaveBeenCalled();
  });

  it('CANCELLED cho đơn đã PAID: paymentStatus chuyển sang REFUNDED', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'PAID',
        items: [],
      })
      .mockResolvedValueOnce(
        minimalFindOneRow({ status: 'CANCELLED', paymentStatus: 'REFUNDED' }),
      );
    const service = new OrdersService(prisma, fakeConfig());

    await service.updateStatus(
      'order-1',
      { status: 'CANCELLED', note: 'Khách đổi ý không mua nữa' },
      'admin-1',
    );

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'CONFIRMED' },
      data: { status: 'CANCELLED', paymentStatus: 'REFUNDED' },
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
    const service = new OrdersService(prisma, fakeConfig());

    await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'SHIPPING' },
      data: { status: 'COMPLETED', paymentStatus: 'PAID' },
    });
  });

  it('SHIPPING → COMPLETED cho đơn VNPAY đã PAID: KHÔNG tự đổi lại paymentStatus', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        orderCode: 'DH20260821ABCDEF',
        status: 'SHIPPING',
        paymentMethod: 'VNPAY',
        paymentStatus: 'PAID',
        items: [],
      })
      .mockResolvedValueOnce(
        minimalFindOneRow({ status: 'COMPLETED', paymentMethod: 'VNPAY' }),
      );
    const service = new OrdersService(prisma, fakeConfig());

    await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');

    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'SHIPPING' },
      data: { status: 'COMPLETED' },
    });
  });

  it('SHIPPING → COMPLETED cho đơn VNPAY CHƯA thanh toán → BadRequestException kèm code ORDER_COMPLETE_REQUIRES_PAYMENT', async () => {
    const { prisma, orderFindUnique, orderUpdateMany } =
      createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValueOnce({
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'SHIPPING',
      paymentMethod: 'VNPAY',
      paymentStatus: 'UNPAID',
      items: [],
    });
    const service = new OrdersService(prisma, fakeConfig());

    let caught: BadRequestException | undefined;
    try {
      await service.updateStatus('order-1', { status: 'COMPLETED' }, 'admin-1');
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 1804 });
    expect(orderUpdateMany).not.toHaveBeenCalled();
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
    const service = new OrdersService(prisma, fakeConfig());

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

  it('→ CANCELLED không kèm note (hoặc note toàn khoảng trắng) → BadRequestException kèm code ORDER_CANCEL_REASON_REQUIRED', async () => {
    const { prisma, orderFindUnique, orderUpdateMany, stockMovementCreate } =
      createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'DH20260821ABCDEF',
      status: 'PENDING',
      paymentMethod: 'COD',
      items: [],
    });
    const service = new OrdersService(prisma, fakeConfig());

    for (const note of [undefined, '   ']) {
      let caught: BadRequestException | undefined;
      try {
        await service.updateStatus(
          'order-1',
          { status: 'CANCELLED', note },
          'admin-1',
        );
      } catch (err) {
        caught = err as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught?.getResponse()).toMatchObject({ code: 1803 });
    }
    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it('order không tồn tại → NotFoundException', async () => {
    const { prisma, orderFindUnique } = createUpdateStatusPrismaMock();
    orderFindUnique.mockResolvedValueOnce(null);
    const service = new OrdersService(prisma, fakeConfig());

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
    const service = new OrdersService(prisma, fakeConfig());

    await expect(
      service.updateStatus('order-1', { status: 'CONFIRMED' }, 'admin-1'),
    ).rejects.toThrow(
      'Đơn hàng vừa được cập nhật bởi thao tác khác, vui lòng thử lại.',
    );
  });

  it('CONFIRMED → PACKING → HANDED_OVER: hợp lệ, không đụng tồn kho/paymentStatus', async () => {
    for (const [from, to] of [
      ['CONFIRMED', 'PACKING'],
      ['PACKING', 'HANDED_OVER'],
    ] as const) {
      const { prisma, orderFindUnique, orderUpdateMany, stockMovementCreate } =
        createUpdateStatusPrismaMock();
      orderFindUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          orderCode: 'DH20260821ABCDEF',
          status: from,
          paymentMethod: 'COD',
          items: [],
        })
        .mockResolvedValueOnce(minimalFindOneRow({ status: to }));
      const service = new OrdersService(prisma, fakeConfig());

      await service.updateStatus('order-1', { status: to }, 'admin-1');

      expect(stockMovementCreate).not.toHaveBeenCalled();
      expect(orderUpdateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: from },
        data: { status: to },
      });
    }
  });

  it('→ CANCELLED vẫn hợp lệ từ PACKING/HANDED_OVER (chưa bắt đầu giao thì còn hủy được)', async () => {
    for (const from of ['PACKING', 'HANDED_OVER'] as const) {
      const { prisma, orderFindUnique, stockMovementCreate } =
        createUpdateStatusPrismaMock();
      orderFindUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          orderCode: 'DH20260821ABCDEF',
          status: from,
          paymentMethod: 'COD',
          items: [{ productVariantId: 'variant-1', quantity: 1 }],
        })
        .mockResolvedValueOnce(minimalFindOneRow({ status: 'CANCELLED' }));
      const service = new OrdersService(prisma, fakeConfig());

      await service.updateStatus(
        'order-1',
        { status: 'CANCELLED', note: 'Khách đổi ý' },
        'admin-1',
      );

      expect(stockMovementCreate).toHaveBeenCalledTimes(1);
    }
  });

  describe('notifyCustomerStatusChange (gửi email báo khách hàng qua backend-user)', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true } as Response);
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('có INTERNAL_NOTIFY_KEY → gọi fetch đúng URL/header/body, KHÔNG chặn kết quả updateStatus', async () => {
      const { prisma, orderFindUnique } = createUpdateStatusPrismaMock();
      orderFindUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          orderCode: 'DH20260821ABCDEF',
          status: 'PENDING',
          paymentMethod: 'COD',
          items: [],
        })
        .mockResolvedValueOnce(minimalFindOneRow({ status: 'CONFIRMED' }));
      const service = new OrdersService(
        prisma,
        fakeConfig({
          INTERNAL_NOTIFY_KEY: 'test-key',
          BACKEND_USER_BASE_URL: 'http://backend-user.test',
        }),
      );

      const result = await service.updateStatus(
        'order-1',
        { status: 'CONFIRMED' },
        'admin-1',
      );

      expect(result).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://backend-user.test/internal/orders/DH20260821ABCDEF/status-notification',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': 'test-key',
          },
          body: JSON.stringify({ status: 'CONFIRMED', note: null }),
        },
      );
    });

    it('thiếu INTERNAL_NOTIFY_KEY → không gọi fetch, không throw', async () => {
      const { prisma, orderFindUnique } = createUpdateStatusPrismaMock();
      orderFindUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          orderCode: 'DH20260821ABCDEF',
          status: 'PENDING',
          paymentMethod: 'COD',
          items: [],
        })
        .mockResolvedValueOnce(minimalFindOneRow({ status: 'CONFIRMED' }));
      const service = new OrdersService(prisma, fakeConfig());

      await service.updateStatus('order-1', { status: 'CONFIRMED' }, 'admin-1');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetch reject (backend-user down) → updateStatus vẫn thành công, không throw', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const { prisma, orderFindUnique } = createUpdateStatusPrismaMock();
      orderFindUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          orderCode: 'DH20260821ABCDEF',
          status: 'PENDING',
          paymentMethod: 'COD',
          items: [],
        })
        .mockResolvedValueOnce(minimalFindOneRow({ status: 'CONFIRMED' }));
      const service = new OrdersService(
        prisma,
        fakeConfig({ INTERNAL_NOTIFY_KEY: 'test-key' }),
      );

      await expect(
        service.updateStatus('order-1', { status: 'CONFIRMED' }, 'admin-1'),
      ).resolves.toBeDefined();
    });
  });
});

function amountDecimal(value: number) {
  return { toNumber: () => value };
}

function bankTransferOrder(
  overrides: Partial<{ paymentStatus: string; status: string }> = {},
) {
  return {
    id: 'order-1',
    orderCode: 'DH20260821ABCDEF',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: overrides.paymentStatus ?? 'UNPAID',
    status: overrides.status ?? 'PENDING',
    totalAmount: amountDecimal(389000),
  };
}

interface PaymentTransactionCreateArgs {
  data: {
    orderId: string;
    provider: string;
    status: string;
    amount: { toNumber(): number };
  };
}

function createMocks() {
  // 2 lần gọi prisma.order.findUnique: lần 1 đọc order trước khi xử lý, lần 2 nằm trong
  // this.findOne(id) gọi lại SAU khi transaction commit (confirmBankTransfer giờ trả về
  // đúng shape findOne() thay vì bản ghi Order thô, khớp với updateStatus()) — mỗi test
  // set 2 giá trị qua .mockResolvedValueOnce() nối tiếp nhau.
  const findUnique = jest.fn();
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  let paymentTransactionCreateArgs: PaymentTransactionCreateArgs | undefined;
  const paymentTransactionCreate = jest
    .fn()
    .mockImplementation((args: PaymentTransactionCreateArgs) => {
      paymentTransactionCreateArgs = args;
      return Promise.resolve({});
    });
  const orderStatusHistoryCreate = jest.fn();

  const tx = {
    order: { updateMany },
    paymentTransaction: { create: paymentTransactionCreate },
    orderStatusHistory: { create: orderStatusHistoryCreate },
  };

  const prisma = {
    order: { findUnique },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    prisma,
    findUnique,
    updateMany,
    paymentTransactionCreate,
    orderStatusHistoryCreate,
    getPaymentTransactionCreateArgs: () => paymentTransactionCreateArgs,
  };
}

describe('OrdersService.confirmBankTransfer', () => {
  it('không tìm thấy đơn thì 404', async () => {
    const { prisma, findUnique } = createMocks();
    findUnique.mockResolvedValue(null);
    const service = new OrdersService(prisma, fakeConfig());

    await expect(
      service.confirmBankTransfer('order-1', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không phải đơn chuyển khoản thì báo lỗi', async () => {
    const { prisma, findUnique } = createMocks();
    findUnique.mockResolvedValue({
      ...bankTransferOrder(),
      paymentMethod: 'VNPAY',
    });
    const service = new OrdersService(prisma, fakeConfig());

    await expect(
      service.confirmBankTransfer('order-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đơn đã PAID rồi thì báo lỗi, không xác nhận lại', async () => {
    const { prisma, findUnique, updateMany } = createMocks();
    findUnique.mockResolvedValue(bankTransferOrder({ paymentStatus: 'PAID' }));
    const service = new OrdersService(prisma, fakeConfig());

    await expect(
      service.confirmBankTransfer('order-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn đã bị hủy thì báo lỗi, không "hồi sinh" lại CONFIRMED', async () => {
    const { prisma, findUnique, updateMany } = createMocks();
    findUnique.mockResolvedValue(bankTransferOrder({ status: 'CANCELLED' }));
    const service = new OrdersService(prisma, fakeConfig());

    await expect(
      service.confirmBankTransfer('order-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('xác nhận thành công (đơn đang PENDING): PAID + CONFIRMED, ghi PaymentTransaction SUCCESS + lịch sử trạng thái, totalAmount là number', async () => {
    const {
      prisma,
      findUnique,
      updateMany,
      orderStatusHistoryCreate,
      getPaymentTransactionCreateArgs,
    } = createMocks();
    findUnique.mockResolvedValueOnce(bankTransferOrder()).mockResolvedValueOnce(
      minimalFindOneRow({
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'PAID',
        totalAmount: amountDecimal(389000),
      }),
    );
    const service = new OrdersService(prisma, fakeConfig());

    const result = await service.confirmBankTransfer('order-1', 'admin-1');

    // where kèm CẢ status lẫn paymentStatus cũ — chốt lại đúng fix của bug đã tìm thấy
    // (thiếu `status` trong where từng khiến 1 race condition có thể "hồi sinh" đơn đã hủy).
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING', paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    const expectedHistoryData = expect.objectContaining({
      orderId: 'order-1',
      fromStatus: 'PENDING',
      toStatus: 'CONFIRMED',
      changedById: 'admin-1',
    }) as unknown as Record<string, unknown>;
    expect(orderStatusHistoryCreate).toHaveBeenCalledWith({
      data: expectedHistoryData,
    });
    const createArgs = getPaymentTransactionCreateArgs();
    expect(createArgs?.data.orderId).toBe('order-1');
    expect(createArgs?.data.provider).toBe('BANK_TRANSFER');
    expect(createArgs?.data.status).toBe('SUCCESS');
    expect(createArgs?.data.amount.toNumber()).toBe(389000);
    expect(result.totalAmount).toBe(389000);
    expect(typeof result.totalAmount).toBe('number');
  });

  it('xác nhận muộn khi đơn đã ở PACKING trở lên: chỉ đổi paymentStatus, KHÔNG kéo lùi status, nhưng VẪN ghi lịch sử', async () => {
    const { prisma, findUnique, updateMany, orderStatusHistoryCreate } =
      createMocks();
    findUnique
      .mockResolvedValueOnce(bankTransferOrder({ status: 'PACKING' }))
      .mockResolvedValueOnce(
        minimalFindOneRow({
          status: 'PACKING',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'PAID',
        }),
      );
    const service = new OrdersService(prisma, fakeConfig());

    await service.confirmBankTransfer('order-1', 'admin-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PACKING', paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', status: 'PACKING' },
    });
    // Trước đây bị bỏ sót — 1 lần xác nhận thanh toán muộn (status không đổi) không để lại
    // dấu vết nào trên tab "Lịch sử trạng thái" ở OrderDetail.tsx. Giờ luôn ghi, kể cả khi
    // fromStatus === toStatus.
    const expectedLateHistoryData = expect.objectContaining({
      orderId: 'order-1',
      fromStatus: 'PACKING',
      toStatus: 'PACKING',
      changedById: 'admin-1',
    }) as unknown as Record<string, unknown>;
    expect(orderStatusHistoryCreate).toHaveBeenCalledWith({
      data: expectedLateHistoryData,
    });
  });
});
