import { InventoryService } from './inventory.service';
import { PrismaService } from '../../config/prisma.service';
import { Prisma } from '@prisma/client';

function createPrismaMock() {
  const findUnique = jest.fn();
  const upsert = jest.fn();
  const prisma = {
    systemConfig: { findUnique, upsert },
  } as unknown as PrismaService;
  return { prisma, findUnique, upsert };
}

describe('InventoryService — low-stock threshold', () => {
  it('returns the default threshold when no config row exists', async () => {
    const { prisma, findUnique } = createPrismaMock();
    findUnique.mockResolvedValue(null);
    const service = new InventoryService(prisma);

    const threshold = await service.getLowStockThreshold();

    expect(threshold).toBe(5);
  });

  it('returns the stored threshold when a config row exists', async () => {
    const { prisma, findUnique } = createPrismaMock();
    findUnique.mockResolvedValue({
      key: 'lowStockThreshold',
      value: '10',
    });
    const service = new InventoryService(prisma);

    const threshold = await service.getLowStockThreshold();

    expect(threshold).toBe(10);
  });

  it('upserts the threshold on set', async () => {
    const { prisma, upsert } = createPrismaMock();
    upsert.mockResolvedValue({
      key: 'lowStockThreshold',
      value: '8',
    });
    const service = new InventoryService(prisma);

    const result = await service.setLowStockThreshold(8);

    expect(result).toBe(8);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: 'lowStockThreshold' },
      create: { key: 'lowStockThreshold', value: '8' },
      update: { value: '8' },
    });
  });
});

describe('InventoryService — findAll', () => {
  function createFindAllPrismaMock() {
    const findUnique = jest.fn().mockResolvedValue(null);
    const transaction = jest.fn();
    const findMany = jest.fn();
    const count = jest.fn();
    const prisma = {
      systemConfig: { findUnique },
      $transaction: transaction,
      productVariant: { findMany, count },
    } as unknown as PrismaService;
    return { prisma, transaction, findMany, count };
  }

  it('marks lowStockOnly filter using the configured threshold', async () => {
    const { prisma, transaction, findMany, count } = createFindAllPrismaMock();
    let capturedFindManyWhere: Prisma.ProductVariantWhereInput | undefined;
    let capturedCountWhere: Prisma.ProductVariantWhereInput | undefined;

    findMany.mockImplementation(
      (args: { where: Prisma.ProductVariantWhereInput }) => {
        capturedFindManyWhere = args.where;
        return Promise.resolve([]);
      },
    );
    count.mockImplementation(
      (args: { where: Prisma.ProductVariantWhereInput }) => {
        capturedCountWhere = args.where;
        return Promise.resolve(0);
      },
    );
    transaction.mockImplementation((queries: Promise<unknown>[]) => {
      return Promise.all(queries);
    });

    const service = new InventoryService(prisma);

    await service.findAll({ lowStockOnly: true, page: 1, limit: 20 });

    // Verify lowStockOnly filter is in the AND array with the threshold value
    expect(capturedFindManyWhere?.AND).toBeDefined();
    const andConditions = capturedFindManyWhere?.AND as
      Prisma.ProductVariantWhereInput[] | undefined;
    const stockFilter = andConditions?.find(
      (item) => (item as Record<string, unknown>).stockQuantity !== undefined,
    );
    expect(stockFilter).toEqual({ stockQuantity: { lte: 5 } });
    expect(capturedCountWhere).toEqual(capturedFindManyWhere);
  });

  it('does not add lowStockOnly filter when not requested', async () => {
    const { prisma, transaction, findMany, count } = createFindAllPrismaMock();
    let capturedFindManyWhere: Prisma.ProductVariantWhereInput | undefined;

    findMany.mockImplementation(
      (args: { where: Prisma.ProductVariantWhereInput }) => {
        capturedFindManyWhere = args.where;
        return Promise.resolve([]);
      },
    );
    count.mockResolvedValue(0);
    transaction.mockImplementation((queries: Promise<unknown>[]) => {
      return Promise.all(queries);
    });

    const service = new InventoryService(prisma);

    await service.findAll({ lowStockOnly: false, page: 1, limit: 20 });

    // Verify lowStockOnly filter is NOT in the AND array
    expect(capturedFindManyWhere?.AND).toBeDefined();
    const andConditions = capturedFindManyWhere?.AND as
      Prisma.ProductVariantWhereInput[] | undefined;
    const stockFilter = andConditions?.find(
      (item) => (item as Record<string, unknown>).stockQuantity !== undefined,
    );
    expect(stockFilter).toBeUndefined();
  });

  it('maps variant + product fields into the response shape', async () => {
    const { prisma, transaction } = createFindAllPrismaMock();
    const variant = {
      id: 'v1',
      sku: 'SKU-1',
      size: 'M',
      color: 'Đen',
      stockQuantity: 3,
      product: {
        id: 'p1',
        name: 'Áo phông',
        slug: 'ao-phong',
        thumbnail: null,
      },
    };
    transaction.mockResolvedValue([[variant], 1]);
    const service = new InventoryService(prisma);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data).toEqual([
      {
        variantId: 'v1',
        sku: 'SKU-1',
        size: 'M',
        color: 'Đen',
        stockQuantity: 3,
        lowStockThreshold: 5,
        productId: 'p1',
        productName: 'Áo phông',
        productSlug: 'ao-phong',
        thumbnail: null,
      },
    ]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });
});

describe('InventoryService — import', () => {
  function createImportPrismaMock(
    variant: { id: string; stockQuantity: number } | null,
  ) {
    const findUnique = jest.fn().mockResolvedValue(variant);
    const update = jest.fn();
    const create = jest.fn();
    const transaction = jest
      .fn()
      .mockResolvedValue([
        {},
        variant
          ? { ...variant, stockQuantity: variant.stockQuantity }
          : undefined,
      ]);
    const prisma = {
      productVariant: { findUnique, update },
      stockMovement: { create },
      $transaction: transaction,
    } as unknown as PrismaService;
    return { prisma, update, create, transaction };
  }

  it('throws NotFoundException when the variant does not exist', async () => {
    const { prisma } = createImportPrismaMock(null);
    const service = new InventoryService(prisma);

    await expect(
      service.import('missing', { quantity: 10 }, 'user-1'),
    ).rejects.toThrow('Không tìm thấy biến thể sản phẩm.');
  });

  it('increments stock and records an IMPORT movement', async () => {
    const { prisma, update, create, transaction } = createImportPrismaMock({
      id: 'v1',
      stockQuantity: 5,
    });
    transaction.mockResolvedValue([{}, { stockQuantity: 15 }]);
    const service = new InventoryService(prisma);

    const result = await service.import(
      'v1',
      { quantity: 10, note: 'lô mới' },
      'user-1',
    );

    expect(result).toEqual({ stockQuantity: 15 });
    expect(transaction).toHaveBeenCalled();

    // Verify stockMovement.create was called with correct data
    expect(create).toHaveBeenCalledWith({
      data: {
        productVariantId: 'v1',
        type: 'IMPORT',
        quantity: 10,
        note: 'lô mới',
        createdById: 'user-1',
      },
    });

    // Verify productVariant.update was called with correct arguments
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { stockQuantity: { increment: 10 } },
    });
  });
});

describe('InventoryService — adjust', () => {
  function createAdjustPrismaMock(
    variant: { id: string; stockQuantity: number } | null,
  ) {
    const findUnique = jest.fn().mockResolvedValue(variant);
    const update = jest.fn();
    const create = jest.fn();
    const transaction = jest.fn();
    const prisma = {
      productVariant: { findUnique, update },
      stockMovement: { create },
      $transaction: transaction,
    } as unknown as PrismaService;
    return { prisma, update, create, transaction };
  }

  it('throws NotFoundException when the variant does not exist', async () => {
    const { prisma } = createAdjustPrismaMock(null);
    const service = new InventoryService(prisma);

    await expect(
      service.adjust(
        'missing',
        { type: 'EXPORT', quantity: 1, reason: 'x' } as never,
        'user-1',
      ),
    ).rejects.toThrow('Không tìm thấy biến thể sản phẩm.');
  });

  it('rejects EXPORT that would make stock negative', async () => {
    const { prisma } = createAdjustPrismaMock({ id: 'v1', stockQuantity: 3 });
    const service = new InventoryService(prisma);

    await expect(
      service.adjust(
        'v1',
        { type: 'EXPORT', quantity: 10, reason: 'chuyển kho' } as never,
        'user-1',
      ),
    ).rejects.toThrow('Số lượng xuất vượt quá tồn kho hiện có.');
  });

  it('applies EXPORT and records a negative movement', async () => {
    const { prisma, update, create, transaction } = createAdjustPrismaMock({
      id: 'v1',
      stockQuantity: 10,
    });
    transaction.mockResolvedValue([{}, { stockQuantity: 6 }]);
    const service = new InventoryService(prisma);

    const result = await service.adjust(
      'v1',
      { type: 'EXPORT', quantity: 4, reason: 'chuyển kho' } as never,
      'user-1',
    );

    expect(result).toEqual({ stockQuantity: 6 });

    // Verify stockMovement.create was called with correct data
    expect(create).toHaveBeenCalledWith({
      data: {
        productVariantId: 'v1',
        type: 'EXPORT',
        quantity: -4,
        note: 'chuyển kho',
        createdById: 'user-1',
      },
    });

    // Verify productVariant.update was called with correct arguments
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { stockQuantity: { increment: -4 } },
    });
  });

  it('rejects ADJUSTMENT with no real change', async () => {
    const { prisma } = createAdjustPrismaMock({ id: 'v1', stockQuantity: 8 });
    const service = new InventoryService(prisma);

    await expect(
      service.adjust(
        'v1',
        { type: 'ADJUSTMENT', actualQuantity: 8, reason: 'kiểm kê' } as never,
        'user-1',
      ),
    ).rejects.toThrow(
      'Số tồn thực tế trùng với hệ thống, không có gì để điều chỉnh.',
    );
  });

  it('applies ADJUSTMENT and records the signed delta', async () => {
    const { prisma, update, create, transaction } = createAdjustPrismaMock({
      id: 'v1',
      stockQuantity: 42,
    });
    transaction.mockResolvedValue([{}, { stockQuantity: 38 }]);
    const service = new InventoryService(prisma);

    const result = await service.adjust(
      'v1',
      {
        type: 'ADJUSTMENT',
        actualQuantity: 38,
        reason: 'kiểm kê thiếu hàng',
      } as never,
      'user-1',
    );

    expect(result).toEqual({ stockQuantity: 38 });

    // Verify stockMovement.create was called with correct data
    expect(create).toHaveBeenCalledWith({
      data: {
        productVariantId: 'v1',
        type: 'ADJUSTMENT',
        quantity: -4,
        note: 'kiểm kê thiếu hàng',
        createdById: 'user-1',
      },
    });

    // Verify productVariant.update was called with correct arguments
    expect(update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { stockQuantity: { increment: -4 } },
    });
  });
});

describe('InventoryService — getHistory', () => {
  function createHistoryPrismaMock() {
    const findMany = jest.fn();
    const count = jest.fn();
    const transaction = jest.fn();
    const prisma = {
      $transaction: transaction,
      stockMovement: { findMany, count },
    } as unknown as PrismaService;
    return { prisma, transaction, findMany, count };
  }

  it('maps movement + variant + product + creator fields into the response shape', async () => {
    const movement = {
      id: 'm1',
      type: 'IMPORT',
      quantity: 10,
      note: 'lô mới',
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      productVariantId: 'v1',
      productVariant: {
        sku: 'SKU-1',
        size: 'M',
        color: 'Đen',
        product: { id: 'p1', name: 'Áo phông' },
      },
      createdBy: { fullName: 'Quản trị viên' },
    };
    const { prisma, transaction } = createHistoryPrismaMock();
    transaction.mockResolvedValue([[movement], 1]);
    const service = new InventoryService(prisma);

    const result = await service.getHistory({ page: 1, limit: 20 });

    expect(result.data).toEqual([
      {
        id: 'm1',
        type: 'IMPORT',
        quantity: 10,
        note: 'lô mới',
        createdAt: movement.createdAt,
        variantId: 'v1',
        sku: 'SKU-1',
        size: 'M',
        color: 'Đen',
        productId: 'p1',
        productName: 'Áo phông',
        createdByName: 'Quản trị viên',
      },
    ]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('falls back to "Hệ thống" when createdBy is null', async () => {
    const movement = {
      id: 'm2',
      type: 'ADJUSTMENT',
      quantity: -2,
      note: 'kiểm kê',
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      productVariantId: 'v1',
      productVariant: {
        sku: 'SKU-1',
        size: 'M',
        color: 'Đen',
        product: { id: 'p1', name: 'Áo phông' },
      },
      createdBy: null,
    };
    const { prisma, transaction } = createHistoryPrismaMock();
    transaction.mockResolvedValue([[movement], 1]);
    const service = new InventoryService(prisma);

    const result = await service.getHistory({ page: 1, limit: 20 });

    expect(result.data[0].createdByName).toBe('Hệ thống');
  });
});
