import { BannersService } from './banners.service';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';

function createMocks() {
  const findMany = jest.fn();
  const count = jest.fn();
  const transaction = jest.fn();
  const prisma = {
    $transaction: transaction,
    banner: { findMany, count },
  } as unknown as PrismaService;
  const upload = {} as unknown as UploadService;
  return { prisma, upload, transaction, findMany, count };
}

function banner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `banner-${Math.random()}`,
    title: 'Banner',
    imageUrl: 'https://example.com/banner.jpg',
    imagePublicId: null,
    linkUrl: null,
    isActive: true,
    sortOrder: 0,
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-01-01'),
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    ...overrides,
  };
}

describe('BannersService.findAll', () => {
  it('không truyền page/limit -> gọi buildSkipTake mặc định page=1 limit=20', async () => {
    const { prisma, upload, transaction, findMany, count } = createMocks();
    findMany.mockResolvedValue([banner({ id: 'b1' }), banner({ id: 'b2' })]);
    count.mockResolvedValue(2);
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    const service = new BannersService(prisma, upload);

    const result = await service.findAll({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('phân trang dùng đúng skip/take theo page/limit, meta tính trên count() (không phải mảng đã cắt)', async () => {
    const { prisma, upload, transaction, findMany, count } = createMocks();
    findMany.mockResolvedValue([banner({ id: 'b3' }), banner({ id: 'b4' })]);
    count.mockResolvedValue(9);
    transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    const service = new BannersService(prisma, upload);

    const result = await service.findAll({ page: 2, limit: 2 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 2, take: 2 }),
    );
    expect(result.meta).toEqual({ total: 9, page: 2, limit: 2, totalPages: 5 });
  });
});
