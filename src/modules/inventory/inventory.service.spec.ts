import { InventoryService } from './inventory.service';
import { PrismaService } from '../../config/prisma.service';

function createPrismaMock() {
  return {
    systemConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('InventoryService — low-stock threshold', () => {
  it('returns the default threshold when no config row exists', async () => {
    const prisma = createPrismaMock();
    (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new InventoryService(prisma);

    const threshold = await service.getLowStockThreshold();

    expect(threshold).toBe(5);
  });

  it('returns the stored threshold when a config row exists', async () => {
    const prisma = createPrismaMock();
    (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue({
      key: 'lowStockThreshold',
      value: '10',
    });
    const service = new InventoryService(prisma);

    const threshold = await service.getLowStockThreshold();

    expect(threshold).toBe(10);
  });

  it('upserts the threshold on set', async () => {
    const prisma = createPrismaMock();
    (prisma.systemConfig.upsert as jest.Mock).mockResolvedValue({
      key: 'lowStockThreshold',
      value: '8',
    });
    const service = new InventoryService(prisma);

    const result = await service.setLowStockThreshold(8);

    expect(result).toBe(8);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'lowStockThreshold' },
      create: { key: 'lowStockThreshold', value: '8' },
      update: { value: '8' },
    });
  });
});

describe('InventoryService — findAll', () => {
  function createFindAllPrismaMock() {
    return {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
      productVariant: { findMany: jest.fn(), count: jest.fn() },
    } as unknown as PrismaService;
  }

  it('marks lowStockOnly filter using the configured threshold', async () => {
    const prisma = createFindAllPrismaMock();
    let capturedFindManyWhere: any;
    let capturedCountWhere: any;

    (prisma.productVariant.findMany as jest.Mock).mockImplementation(
      (args: any) => {
        capturedFindManyWhere = args.where;
        return Promise.resolve([]);
      },
    );
    (prisma.productVariant.count as jest.Mock).mockImplementation((args: any) => {
      capturedCountWhere = args.where;
      return Promise.resolve(0);
    });
    (prisma.$transaction as jest.Mock).mockImplementation((queries: any[]) => {
      return Promise.all(queries);
    });

    const service = new InventoryService(prisma);

    await service.findAll({ lowStockOnly: true, page: 1, limit: 20 });

    // Verify lowStockOnly filter is in the AND array with the threshold value
    expect(capturedFindManyWhere?.AND).toBeDefined();
    const stockFilter = capturedFindManyWhere.AND.find(
      (item: any) => item.stockQuantity?.lte !== undefined,
    );
    expect(stockFilter).toEqual({ stockQuantity: { lte: 5 } });
    expect(capturedCountWhere).toEqual(capturedFindManyWhere);
  });

  it('does not add lowStockOnly filter when not requested', async () => {
    const prisma = createFindAllPrismaMock();
    let capturedFindManyWhere: any;

    (prisma.productVariant.findMany as jest.Mock).mockImplementation(
      (args: any) => {
        capturedFindManyWhere = args.where;
        return Promise.resolve([]);
      },
    );
    (prisma.productVariant.count as jest.Mock).mockResolvedValue(0);
    (prisma.$transaction as jest.Mock).mockImplementation((queries: any[]) => {
      return Promise.all(queries);
    });

    const service = new InventoryService(prisma);

    await service.findAll({ lowStockOnly: false, page: 1, limit: 20 });

    // Verify lowStockOnly filter is NOT in the AND array
    expect(capturedFindManyWhere?.AND).toBeDefined();
    const stockFilter = capturedFindManyWhere.AND.find(
      (item: any) => item.stockQuantity !== undefined,
    );
    expect(stockFilter).toBeUndefined();
  });

  it('maps variant + product fields into the response shape', async () => {
    const prisma = createFindAllPrismaMock();
    const variant = {
      id: 'v1',
      sku: 'SKU-1',
      size: 'M',
      color: 'Đen',
      stockQuantity: 3,
      product: { id: 'p1', name: 'Áo phông', slug: 'ao-phong', thumbnail: null },
    };
    (prisma.$transaction as jest.Mock).mockResolvedValue([[variant], 1]);
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
    expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
  });
});

describe('InventoryService — import', () => {
  function createImportPrismaMock(variant: { id: string; stockQuantity: number } | null) {
    return {
      productVariant: {
        findUnique: jest.fn().mockResolvedValue(variant),
        update: jest.fn(),
      },
      stockMovement: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([
        {},
        variant ? { ...variant, stockQuantity: variant.stockQuantity } : undefined,
      ]),
    } as unknown as PrismaService;
  }

  it('throws NotFoundException when the variant does not exist', async () => {
    const prisma = createImportPrismaMock(null);
    const service = new InventoryService(prisma);

    await expect(
      service.import('missing', { quantity: 10 }, 'user-1'),
    ).rejects.toThrow('Không tìm thấy biến thể sản phẩm');
  });

  it('increments stock and records an IMPORT movement', async () => {
    const prisma = createImportPrismaMock({ id: 'v1', stockQuantity: 5 });
    (prisma.$transaction as jest.Mock).mockResolvedValue([{}, { stockQuantity: 15 }]);
    const service = new InventoryService(prisma);

    const result = await service.import('v1', { quantity: 10, note: 'lô mới' }, 'user-1');

    expect(result).toEqual({ stockQuantity: 15 });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
