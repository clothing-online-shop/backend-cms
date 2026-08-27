import { CollectionsService } from './collections.service';
import { PrismaService } from '../../config/prisma.service';
import { CollectionStatus } from './collection-status.enum';
import { ConflictException } from '@nestjs/common';

function createMocks() {
  const findMany = jest.fn();
  const prisma = {
    collection: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
}

function createMocksForCreate() {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();
  const prisma = {
    collection: { findMany, findFirst, create },
  } as unknown as PrismaService;
  return { prisma, findMany, findFirst, create };
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

describe('CollectionsService.create - assertStartDateNotInPast regression', () => {
  it('startDate ở trong quá khứ -> throw ConflictException với ErrorCode.COLLECTION_START_DATE_IN_PAST', async () => {
    const { prisma, findFirst, create } = createMocksForCreate();
    findFirst.mockResolvedValue(null); // không tìm thấy slug tồn tại -> tạo được
    const service = new CollectionsService(prisma);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const dto = {
      name: 'Test Collection',
      startDate: yesterday.toISOString(),
      endDate: new Date(
        new Date().setDate(new Date().getDate() + 30),
      ).toISOString(),
    };

    const promise = service.create(dto);

    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    // Đảm bảo không gọi create() nếu date validation thất bại
    expect(create).not.toHaveBeenCalled();
  });

  it('startDate = hôm nay -> tạo collection thành công (không throw)', async () => {
    const { prisma, findFirst, create } = createMocksForCreate();
    findFirst.mockResolvedValue(null); // không tìm thấy slug tồn tại

    const today = new Date().toISOString();
    const tomorrow = new Date(
      new Date().setDate(new Date().getDate() + 1),
    ).toISOString();

    const mockCollection = runningCollection({
      startDate: new Date(today),
      endDate: new Date(tomorrow),
    });
    create.mockResolvedValue(mockCollection);

    const service = new CollectionsService(prisma);
    const dto = {
      name: 'Test Collection',
      startDate: today,
      endDate: tomorrow,
    };

    const result = await service.create(dto);

    expect(result).toBeDefined();
    expect(result.status).toBe(CollectionStatus.RUNNING);
    expect(create).toHaveBeenCalled();
  });

  it('startDate ở trong tương lai -> tạo collection thành công (không throw)', async () => {
    const { prisma, findFirst, create } = createMocksForCreate();
    findFirst.mockResolvedValue(null); // không tìm thấy slug tồn tại

    const tomorrow = new Date(
      new Date().setDate(new Date().getDate() + 1),
    ).toISOString();
    const afterTomorrow = new Date(
      new Date().setDate(new Date().getDate() + 2),
    ).toISOString();

    const mockCollection = runningCollection({
      startDate: new Date(tomorrow),
      endDate: new Date(afterTomorrow),
    });
    create.mockResolvedValue(mockCollection);

    const service = new CollectionsService(prisma);
    const dto = {
      name: 'Test Collection',
      startDate: tomorrow,
      endDate: afterTomorrow,
    };

    const result = await service.create(dto);

    expect(result).toBeDefined();
    // Status should be UPCOMING (not RUNNING) since startDate is in the future
    expect(result.status).toBe(CollectionStatus.UPCOMING);
    expect(create).toHaveBeenCalled();
  });
});
