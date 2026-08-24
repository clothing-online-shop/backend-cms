import { CollectionsService } from './collections.service';
import { PrismaService } from '../../config/prisma.service';
import { CollectionStatus } from './collection-status.enum';

function createMocks() {
  const findMany = jest.fn();
  const prisma = {
    collection: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
}

// startDate xa trong quá khứ + endDate xa trong tương lai -> luôn suy ra RUNNING (xem
// deriveDateRangeStatus trong date.util.ts) — dùng làm mặc định, test ENDED tự override.
function runningCollection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `collection-${Math.random()}`,
    name: 'Collection',
    slug: 'collection',
    banner: null,
    bannerPublicId: null,
    description: null,
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-01-01'),
    isDelete: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    products: [],
    ...overrides,
  };
}

function endedCollection(overrides: Partial<Record<string, unknown>> = {}) {
  return runningCollection({
    startDate: new Date('2020-01-01'),
    endDate: new Date('2020-06-01'),
    ...overrides,
  });
}

describe('CollectionsService.findAll', () => {
  it('không truyền page/limit -> mặc định page=1 limit=20', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningCollection({ id: 'c1' }),
      runningCollection({ id: 'c2' }),
    ]);
    const service = new CollectionsService(prisma);

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
        runningCollection({ id: `c${i + 1}` }),
      ),
    );
    const service = new CollectionsService(prisma);

    const page2 = await service.findAll({ page: 2, limit: 2 });

    expect(page2.data.map((c) => c.id)).toEqual(['c3', 'c4']);
    expect(page2.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  it('excludeEnded=true lọc xong mới phân trang -> total khớp đúng kết quả đã lọc', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningCollection({ id: 'running-1' }),
      endedCollection({ id: 'ended-1' }),
      runningCollection({ id: 'running-2' }),
      endedCollection({ id: 'ended-2' }),
    ]);
    const service = new CollectionsService(prisma);

    const result = await service.findAll({
      excludeEnded: 'true',
      page: 1,
      limit: 20,
    });

    expect(result.data.every((c) => c.status !== CollectionStatus.ENDED)).toBe(
      true,
    );
    expect(result.meta.total).toBe(2);
  });
});
