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
