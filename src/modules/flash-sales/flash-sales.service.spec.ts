import { FlashSalesService } from './flash-sales.service';
import { PrismaService } from '../../config/prisma.service';

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
