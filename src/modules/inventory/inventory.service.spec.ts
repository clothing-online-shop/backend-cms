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
    (prisma.$transaction as jest.Mock).mockResolvedValue([[], 0]);
    const service = new InventoryService(prisma);

    await service.findAll({ lowStockOnly: true, page: 1, limit: 20 });

    expect(prisma.$transaction).toHaveBeenCalled();
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
