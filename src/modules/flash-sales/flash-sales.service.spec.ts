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

// startDate xa quá khứ + endDate xa tương lai -> luôn RUNNING (deriveDateRangeStatus).
function runningFlashSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `fs-${Math.random()}`,
    name: 'Flash Sale',
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-01-01'),
    isDelete: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    items: [],
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
