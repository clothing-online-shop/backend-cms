import {
  FlashSalesService,
  validateFlashSaleItems,
} from './flash-sales.service';
import { PrismaService } from '../../config/prisma.service';
import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';

function createMocks() {
  const findMany = jest.fn();
  const prisma = {
    flashSale: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
}

// startDate xa quá khứ + endDate xa tương lai -> luôn RUNNING (deriveInstantRangeStatus).
// `_count: { items: N }` là đúng shape mà findMany({ include: { _count: { select: { items } } } })
// trả về — findAll() dùng nó để tính itemCount thay vì materialize cả mảng items[].
function runningFlashSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `fs-${Math.random()}`,
    name: 'Flash Sale',
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-01-01'),
    isDelete: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    _count: { items: 0 },
    ...overrides,
  };
}

function endedFlashSale(overrides: Partial<Record<string, unknown>> = {}) {
  return runningFlashSale({
    startDate: new Date('2020-01-01'),
    endDate: new Date('2020-06-01'),
    ...overrides,
  });
}

describe('FlashSalesService.findAll', () => {
  it('không truyền page/limit -> mặc định page=1 limit=20', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningFlashSale({ id: 'fs1' }),
      runningFlashSale({ id: 'fs2' }),
    ]);
    const service = new FlashSalesService(prisma);

    const result = await service.findAll({});

    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('phân trang cắt đúng phần tử theo page/limit', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) =>
        runningFlashSale({ id: `fs${i + 1}` }),
      ),
    );
    const service = new FlashSalesService(prisma);

    const page2 = await service.findAll({ page: 2, limit: 2 });

    expect(page2.data.map((fs) => fs.id)).toEqual(['fs3', 'fs4']);
    expect(page2.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  it('filter status=ENDED lọc xong mới phân trang -> total khớp đúng kết quả đã lọc', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningFlashSale({ id: 'running-1' }),
      endedFlashSale({ id: 'ended-1' }),
      endedFlashSale({ id: 'ended-2' }),
    ]);
    const service = new FlashSalesService(prisma);

    const result = await service.findAll({
      status: 'ENDED',
      page: 1,
      limit: 20,
    });

    expect(result.data.map((fs) => fs.id).sort()).toEqual([
      'ended-1',
      'ended-2',
    ]);
    expect(result.meta.total).toBe(2);
  });

  it('itemCount lấy từ _count.items và KHÔNG rò rỉ items[]/_count ra response', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningFlashSale({ id: 'fs1', _count: { items: 3 } }),
    ]);
    const service = new FlashSalesService(prisma);

    const result = await service.findAll({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { _count: { select: { items: true } } },
      }),
    );
    expect(result.data[0].itemCount).toBe(3);
    expect(result.data[0]).not.toHaveProperty('items');
    expect(result.data[0]).not.toHaveProperty('_count');
  });
});

describe('FlashSalesService.findOne', () => {
  function createDetailMocks() {
    const findUnique = jest.fn();
    const prisma = { flashSale: { findUnique } } as unknown as PrismaService;
    return { prisma, findUnique };
  }

  it('không tìm thấy -> NotFoundException kèm code 2201', async () => {
    const { prisma, findUnique } = createDetailMocks();
    findUnique.mockResolvedValue(null);
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.findOne('missing');
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2201 });
  });

  it('đã bị xóa mềm (isDelete=true) -> coi như không tìm thấy', async () => {
    const { prisma, findUnique } = createDetailMocks();
    findUnique.mockResolvedValue({
      ...runningFlashSale(),
      isDelete: true,
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await expect(service.findOne('fs-deleted')).rejects.toMatchObject({
      status: 404,
    });
  });
});

function variant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? 'variant-1',
    price: new Prisma.Decimal((overrides.price as number) ?? 200000),
    stockQuantity: (overrides.stockQuantity as number) ?? 10,
    sku: (overrides.sku as string) ?? 'SKU-1',
  };
}

describe('validateFlashSaleItems', () => {
  function createValidationMocks() {
    const variantFindMany = jest.fn();
    const itemFindMany = jest.fn();
    const prisma = {
      productVariant: { findMany: variantFindMany },
      flashSaleItem: { findMany: itemFindMany },
    };
    return { prisma, variantFindMany, itemFindMany };
  }

  const NEW_START = new Date('2026-09-01T00:00:00.000Z');
  const NEW_END = new Date('2026-09-02T00:00:00.000Z');

  it('hợp lệ -> trả về đúng danh sách item đã chuẩn hóa (salePrice là Decimal)', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-1', price: 200000, stockQuantity: 10 }),
    ]);
    itemFindMany.mockResolvedValue([]);

    const result = await validateFlashSaleItems(
      prisma as never,
      [{ productVariantId: 'variant-1', salePrice: 150000, quantityLimit: 5 }],
      NEW_START,
      NEW_END,
      null,
    );

    expect(result).toEqual([
      {
        productVariantId: 'variant-1',
        salePrice: new Prisma.Decimal(150000),
        quantityLimit: 5,
      },
    ]);
  });

  it('salePrice >= giá gốc -> BadRequestException kèm code 2203', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-1', price: 100000 }),
    ]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [
          {
            productVariantId: 'variant-1',
            salePrice: 100000,
            quantityLimit: 1,
          },
        ],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 2203 });
  });

  it('quantityLimit > tồn kho -> BadRequestException kèm code 2204', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-1', stockQuantity: 3 }),
    ]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 4 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2204 });
  });

  it('biến thể trùng với đợt sale khác còn hiệu lực, khung giờ giao nhau -> ConflictException kèm code 2205', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    itemFindMany.mockResolvedValue([
      {
        productVariantId: 'variant-1',
        flashSaleId: 'other-flash-sale',
        flashSale: { name: 'Đợt sale khác' },
        productVariant: { sku: 'SKU-1' },
      },
    ]);

    let caught: ConflictException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
  });

  it('đang sửa 1 flash sale (excludeFlashSaleId) -> tự loại trừ chính nó khỏi check trùng', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    itemFindMany.mockResolvedValue([]);

    await validateFlashSaleItems(
      prisma as never,
      [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 }],
      NEW_START,
      NEW_END,
      'this-flash-sale-id',
    );

    expect(itemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          flashSaleId: { not: 'this-flash-sale-id' },
        }) as unknown,
      }),
    );
  });

  it('2 item cùng productVariantId trong 1 payload -> BadRequestException kèm code 2213', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
          { productVariantId: 'variant-1', salePrice: 2000, quantityLimit: 2 },
        ],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 2213 });
    // Chặn ngay trước khi chạm DB — không tốn query nào cho payload chắc chắn sai.
    expect(variantFindMany).not.toHaveBeenCalled();
  });

  it('biến thể không tồn tại -> BadRequestException kèm code 2202', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [
          {
            productVariantId: 'variant-missing',
            salePrice: 1000,
            quantityLimit: 1,
          },
        ],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2202 });
  });
});

describe('FlashSalesService.create', () => {
  function createCreateMocks() {
    const variantFindMany = jest
      .fn()
      .mockResolvedValue([
        variant({ id: 'variant-1', price: 200000, stockQuantity: 10 }),
      ]);
    const itemFindMany = jest.fn().mockResolvedValue([]);
    const flashSaleCreate = jest.fn().mockResolvedValue({ id: 'fs-new' });
    const flashSaleFindUnique = jest.fn().mockResolvedValue({
      id: 'fs-new',
      name: 'Sale 12.12',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
      items: [],
    });
    const prisma = {
      productVariant: { findMany: variantFindMany },
      flashSaleItem: { findMany: itemFindMany },
      flashSale: { create: flashSaleCreate, findUnique: flashSaleFindUnique },
    } as unknown as PrismaService;
    return { prisma, flashSaleCreate, flashSaleFindUnique };
  }

  const FUTURE_START = new Date(Date.now() + 86400000).toISOString();
  const FUTURE_END = new Date(Date.now() + 172800000).toISOString();

  it('input hợp lệ -> tạo flash sale kèm items và trả về detail (status UPCOMING)', async () => {
    const { prisma, flashSaleCreate, flashSaleFindUnique } =
      createCreateMocks();
    const service = new FlashSalesService(prisma);

    const result = await service.create({
      name: 'Sale 12.12',
      startDate: FUTURE_START,
      endDate: FUTURE_END,
      items: [
        { productVariantId: 'variant-1', salePrice: 150000, quantityLimit: 5 },
      ],
    });

    expect(flashSaleCreate).toHaveBeenCalledWith({
      data: {
        name: 'Sale 12.12',
        startDate: new Date(FUTURE_START),
        endDate: new Date(FUTURE_END),
        items: {
          create: [
            {
              productVariantId: 'variant-1',
              salePrice: new Prisma.Decimal(150000),
              quantityLimit: 5,
            },
          ],
        },
      },
    });
    // create() trả về detail bằng cách gọi lại findOne(created.id).
    expect(flashSaleFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fs-new' } }),
    );
    expect(result).toMatchObject({ id: 'fs-new', status: 'UPCOMING' });
  });

  it('startDate trong quá khứ -> BadRequestException kèm code 2212, không gọi create', async () => {
    const { prisma, flashSaleCreate } = createCreateMocks();
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.create({
        name: 'Sale quá khứ',
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: FUTURE_END,
        items: [
          {
            productVariantId: 'variant-1',
            salePrice: 150000,
            quantityLimit: 5,
          },
        ],
      });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 2212 });
    expect(flashSaleCreate).not.toHaveBeenCalled();
  });

  // Chính là bug Finding 1: đợt sale chỉ kéo dài vài giờ TRONG CÙNG NGÀY (vd tạo lúc 09:00,
  // sale chạy 20:00-22:00) — với deriveDateRangeStatus() (cắt về ngày lịch) nó bị báo RUNNING
  // ngay khi vừa tạo (khóa luôn sửa/xóa); deriveInstantRangeStatus() phải trả UPCOMING.
  it('khung giờ vài tiếng trong cùng ngày, chưa tới giờ bắt đầu -> status UPCOMING chứ không phải RUNNING', async () => {
    const { prisma, flashSaleCreate, flashSaleFindUnique } =
      createCreateMocks();
    const startDate = new Date(Date.now() + 60 * 60 * 1000);
    const endDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
    flashSaleFindUnique.mockResolvedValue({
      id: 'fs-new',
      name: 'Sale tối nay',
      startDate,
      endDate,
      isDelete: false,
      items: [],
    });
    const service = new FlashSalesService(prisma);

    const result = await service.create({
      name: 'Sale tối nay',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      items: [
        { productVariantId: 'variant-1', salePrice: 150000, quantityLimit: 5 },
      ],
    });

    expect(flashSaleCreate).toHaveBeenCalled();
    expect(result.status).toBe('UPCOMING');
  });
});

describe('FlashSalesService.update — luật theo trạng thái', () => {
  function createUpdateMocks() {
    const findUnique = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const flashSaleItemDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    // Nhánh "không đổi items" của update() đọc item hiện có để re-check overlap với khung giờ
    // MỚI — mặc định trả [] (không có item -> bỏ qua check), test nào cần thì override.
    const flashSaleItemFindMany = jest.fn().mockResolvedValue([]);
    const variantFindMany = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn((cb: (tx: unknown) => unknown) =>
      typeof cb === 'function'
        ? cb({
            flashSale: { update },
            flashSaleItem: { deleteMany: flashSaleItemDeleteMany },
          })
        : Promise.all(cb as unknown as Promise<unknown>[]),
    );
    const prisma = {
      flashSale: { findUnique, update },
      flashSaleItem: {
        deleteMany: flashSaleItemDeleteMany,
        findMany: flashSaleItemFindMany,
      },
      productVariant: { findMany: variantFindMany },
      $transaction: transaction,
    } as unknown as PrismaService;
    return {
      prisma,
      findUnique,
      update,
      flashSaleItemDeleteMany,
      flashSaleItemFindMany,
      variantFindMany,
      transaction,
    };
  }

  it('RUNNING + chỉ sửa endDate -> cho phép', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.update('fs-1', { endDate: new Date().toISOString() });

    expect(update).toHaveBeenCalled();
  });

  it('RUNNING + cố sửa name -> ConflictException kèm code 2206, không gọi update', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.update('fs-1', { name: 'Tên mới' });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2206 });
    expect(update).not.toHaveBeenCalled();
  });

  it('ENDED + sửa bất kỳ field nào -> ConflictException kèm code 2207', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-02-01'),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.update('fs-1', { endDate: new Date().toISOString() });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2207 });
    expect(update).not.toHaveBeenCalled();
  });

  // Finding 2: chỉ đổi endDate (không đụng items) vẫn phải re-check overlap của item HIỆN CÓ
  // với khung giờ MỚI — kéo dài endDate có thể tạo chồng lấn với 1 campaign khác.
  it('RUNNING + kéo dài endDate khiến item hiện có chồng lấn đợt khác -> ConflictException kèm code 2205, không gọi update', async () => {
    const { prisma, findUnique, update, flashSaleItemFindMany } =
      createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 3600000),
      isDelete: false,
    });
    // Lần 1: item hiện có của chính campaign này. Lần 2: kết quả check overlap.
    flashSaleItemFindMany.mockResolvedValueOnce([
      { id: 'item-1', flashSaleId: 'fs-1', productVariantId: 'variant-1' },
    ]);
    flashSaleItemFindMany.mockResolvedValueOnce([
      {
        productVariantId: 'variant-1',
        flashSaleId: 'other-flash-sale',
        flashSale: { name: 'Đợt sale khác' },
        productVariant: { sku: 'SKU-1' },
      },
    ]);
    const service = new FlashSalesService(prisma);

    let caught: ConflictException | undefined;
    try {
      await service.update('fs-1', {
        endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
    expect(update).not.toHaveBeenCalled();
  });

  // Finding 5: nhánh thay thế toàn bộ items (UPCOMING + dto.items) chạy trong $transaction
  // dạng MẢNG — deleteMany item cũ rồi update kèm items.create mới, phải cùng 1 transaction.
  it('UPCOMING + đổi items -> $transaction nhận mảng gồm deleteMany và update kèm items.create', async () => {
    const {
      prisma,
      findUnique,
      update,
      flashSaleItemDeleteMany,
      variantFindMany,
      transaction,
    } = createUpdateMocks();
    const futureStart = new Date(Date.now() + 86400000);
    const futureEnd = new Date(Date.now() + 172800000);
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: futureStart,
      endDate: futureEnd,
      isDelete: false,
    });
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: futureStart,
      endDate: futureEnd,
      items: [],
    });
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-1', price: 200000, stockQuantity: 10 }),
    ]);
    const service = new FlashSalesService(prisma);

    await service.update('fs-1', {
      items: [
        { productVariantId: 'variant-1', salePrice: 150000, quantityLimit: 5 },
      ],
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Array));
    expect((transaction.mock.calls[0][0] as unknown[]).length).toBe(2);
    expect(flashSaleItemDeleteMany).toHaveBeenCalledWith({
      where: { flashSaleId: 'fs-1' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'fs-1' },
      data: {
        name: undefined,
        startDate: undefined,
        endDate: undefined,
        items: {
          create: [
            {
              productVariantId: 'variant-1',
              salePrice: new Prisma.Decimal(150000),
              quantityLimit: 5,
            },
          ],
        },
      },
    });
  });
});

describe('FlashSalesService.endNow', () => {
  function createEndNowMocks() {
    const findUnique = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      flashSale: { findUnique, update },
    } as unknown as PrismaService;
    return { prisma, findUnique, update };
  }

  it('đang RUNNING -> set endDate về hiện tại', async () => {
    const { prisma, findUnique, update } = createEndNowMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.endNow('fs-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fs-1' },
        data: { endDate: expect.any(Date) as Date },
      }),
    );
  });

  it('chưa RUNNING (UPCOMING) -> ConflictException kèm code 2211, không gọi update', async () => {
    const { prisma, findUnique, update } = createEndNowMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await expect(service.endNow('fs-1')).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('FlashSalesService.remove', () => {
  function createRemoveMocks() {
    // $transaction phải THỰC SỰ gọi callback được truyền vào, nếu không thân hàm remove()
    // (deleteMany + update) không bao giờ chạy dưới test và assertion "xóa mềm thành công"
    // chỉ đang kiểm tra rằng $transaction được gọi, chứ không kiểm tra nó làm gì.
    const findUnique = jest.fn();
    const txDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const txUpdate = jest.fn().mockResolvedValue({});
    const transaction = jest.fn((cb: unknown) =>
      typeof cb === 'function'
        ? (cb as (tx: unknown) => unknown)({
            flashSaleItem: { deleteMany: txDeleteMany },
            flashSale: { update: txUpdate },
          })
        : Promise.resolve([]),
    );
    const prisma = {
      flashSale: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService;
    return { prisma, findUnique, transaction, txDeleteMany, txUpdate };
  }

  it('đang RUNNING -> ConflictException kèm code 2208, không xóa', async () => {
    const { prisma, findUnique, transaction } = createRemoveMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await expect(service.remove('fs-1')).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('UPCOMING -> xóa mềm thành công (xóa item con + set isDelete trong cùng transaction)', async () => {
    const { prisma, findUnique, transaction, txDeleteMany, txUpdate } =
      createRemoveMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await service.remove('fs-1');

    expect(transaction).toHaveBeenCalled();
    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { flashSaleId: 'fs-1' },
    });
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'fs-1' },
      data: { isDelete: true },
    });
  });
});

describe('FlashSalesService.updateSoldCount', () => {
  function createSoldCountMocks() {
    const itemFindUnique = jest.fn();
    const itemUpdate = jest.fn().mockResolvedValue({});
    const flashSaleFindUnique = jest.fn();
    const prisma = {
      flashSaleItem: { findUnique: itemFindUnique, update: itemUpdate },
      flashSale: { findUnique: flashSaleFindUnique },
    } as unknown as PrismaService;
    return { prisma, itemFindUnique, itemUpdate, flashSaleFindUnique };
  }

  it('soldCount vượt quantityLimit -> BadRequestException kèm code 2210', async () => {
    const { prisma, itemFindUnique } = createSoldCountMocks();
    itemFindUnique.mockResolvedValue({
      id: 'item-1',
      flashSaleId: 'fs-1',
      quantityLimit: 5,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.updateSoldCount('fs-1', 'item-1', { soldCount: 6 });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2210 });
  });

  it('item không thuộc đúng flash sale -> NotFoundException kèm code 2209', async () => {
    const { prisma, itemFindUnique } = createSoldCountMocks();
    itemFindUnique.mockResolvedValue({
      id: 'item-1',
      flashSaleId: 'other-fs',
      quantityLimit: 5,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.updateSoldCount('fs-1', 'item-1', { soldCount: 1 });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2209 });
  });
});

describe('FlashSalesService.addItems', () => {
  function createAddItemsMocks() {
    const flashSaleFindUnique = jest.fn();
    const variantFindMany = jest.fn();
    const itemFindMany = jest.fn();
    const itemCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      flashSale: { findUnique: flashSaleFindUnique },
      productVariant: { findMany: variantFindMany },
      flashSaleItem: { findMany: itemFindMany, createMany: itemCreateMany },
    } as unknown as PrismaService;
    return {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    };
  }

  it('không phải RUNNING (UPCOMING) -> ConflictException kèm code 2214, không gọi createMany', async () => {
    const { prisma, flashSaleFindUnique, itemCreateMany } =
      createAddItemsMocks();
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
        ],
      });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2214 });
    expect(itemCreateMany).not.toHaveBeenCalled();
  });

  it('RUNNING + item hợp lệ -> createMany thêm item mới, KHÔNG gọi deleteMany bao giờ', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-2', price: 200000, stockQuantity: 10 }),
    ]);
    itemFindMany.mockResolvedValue([]);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.addItems('fs-1', {
      items: [
        { productVariantId: 'variant-2', salePrice: 150000, quantityLimit: 3 },
      ],
    });

    expect(itemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          productVariantId: 'variant-2',
          salePrice: new Prisma.Decimal(150000),
          quantityLimit: 3,
          flashSaleId: 'fs-1',
        },
      ],
    });
    // KHÔNG mock prisma.flashSaleItem.deleteMany ở test này — nếu addItems() lỡ gọi
    // deleteMany (giống nhầm sang cơ chế thay thế toàn bộ của update()), test sẽ crash ngay
    // tại đây vì "deleteMany is not a function", tự bắt được deviation quan trọng nhất.
  });

  it('RUNNING + thêm nhiều item cùng lúc -> createMany nhận đủ mảng, giữ đúng thứ tự', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-2', price: 200000, stockQuantity: 10 }),
      variant({ id: 'variant-3', price: 300000, stockQuantity: 5 }),
    ]);
    itemFindMany.mockResolvedValue([]);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.addItems('fs-1', {
      items: [
        { productVariantId: 'variant-2', salePrice: 150000, quantityLimit: 3 },
        { productVariantId: 'variant-3', salePrice: 250000, quantityLimit: 2 },
      ],
    });

    expect(itemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          productVariantId: 'variant-2',
          salePrice: new Prisma.Decimal(150000),
          quantityLimit: 3,
          flashSaleId: 'fs-1',
        },
        {
          productVariantId: 'variant-3',
          salePrice: new Prisma.Decimal(250000),
          quantityLimit: 2,
          flashSaleId: 'fs-1',
        },
      ],
    });
  });

  it('đã ENDED -> ConflictException kèm code 2214, không gọi createMany (cùng nhánh status !== RUNNING với UPCOMING)', async () => {
    const { prisma, flashSaleFindUnique, itemCreateMany } =
      createAddItemsMocks();
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-02-01'),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
        ],
      });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2214 });
    expect(itemCreateMany).not.toHaveBeenCalled();
  });

  it('RUNNING + trùng biến thể đã có sẵn trong chính campaign -> ConflictException kèm code 2205', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    // Item trùng thuộc CHÍNH campaign đang thêm (flashSaleId: 'fs-1') — addItems() gọi
    // validateFlashSaleItems() với excludeFlashSaleId=null (không loại trừ chính nó), nên
    // overlap-check phải tự bắt được trường hợp "thêm lại 1 biến thể đã có sẵn".
    itemFindMany.mockResolvedValue([
      {
        productVariantId: 'variant-1',
        flashSaleId: 'fs-1',
        flashSale: { name: 'Flash Sale' },
        productVariant: { sku: 'SKU-1' },
      },
    ]);
    const service = new FlashSalesService(prisma);

    let caught: ConflictException | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
        ],
      });
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
    expect(itemCreateMany).not.toHaveBeenCalled();
  });

  it('createMany vi phạm unique constraint (race condition) -> ConflictException kèm code 2205, không lộ lỗi Prisma thô', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-3', price: 200000, stockQuantity: 10 }),
    ]);
    itemFindMany.mockResolvedValue([]);
    itemCreateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    const service = new FlashSalesService(prisma);

    let caught: ConflictException | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          {
            productVariantId: 'variant-3',
            salePrice: 150000,
            quantityLimit: 2,
          },
        ],
      });
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
  });
});
