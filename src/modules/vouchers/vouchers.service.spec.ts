import { Prisma } from '@prisma/client';
import { VouchersService } from './vouchers.service';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';
import { VoucherStatus } from './voucher-status.enum';

function createMocks() {
  const findMany = jest.fn();
  const prisma = {
    voucher: { findMany },
  } as unknown as PrismaService;
  const upload = {} as unknown as UploadService;
  return { prisma, upload, findMany };
}

// isActive=true, startsAt đã qua, không expiresAt, còn lượt -> luôn suy ra ACTIVE (xem
// deriveVoucherStatus trong vouchers.service.ts) — dùng làm mặc định, test nào cần
// INACTIVE thì tự override field liên quan.
function activeVoucher(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `voucher-${Math.random()}`,
    code: 'CODE',
    imageUrl: null,
    imagePublicId: null,
    discountType: 'PERCENTAGE',
    discountValue: new Prisma.Decimal(10),
    maxDiscountAmount: null,
    minOrderValue: new Prisma.Decimal(0),
    startsAt: new Date('2020-01-01'),
    expiresAt: null,
    usageLimit: null,
    usedCount: 0,
    perCustomerLimit: null,
    isActive: true,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    ...overrides,
  };
}

describe('VouchersService.findAll', () => {
  it('không truyền page/limit -> mặc định page=1 limit=20, meta.total đúng', async () => {
    const { prisma, upload, findMany } = createMocks();
    findMany.mockResolvedValue([
      activeVoucher({ id: 'v1' }),
      activeVoucher({ id: 'v2' }),
    ]);
    const service = new VouchersService(prisma, upload);

    const result = await service.findAll({});

    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('phân trang cắt đúng phần tử theo page/limit, meta.total tính trên toàn bộ (chưa cắt)', async () => {
    const { prisma, upload, findMany } = createMocks();
    findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => activeVoucher({ id: `v${i + 1}` })),
    );
    const service = new VouchersService(prisma, upload);

    const page1 = await service.findAll({ page: 1, limit: 2 });
    expect(page1.data.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(page1.meta).toEqual({ total: 5, page: 1, limit: 2, totalPages: 3 });

    const page3 = await service.findAll({ page: 3, limit: 2 });
    expect(page3.data.map((v) => v.id)).toEqual(['v5']);
    expect(page3.meta).toEqual({ total: 5, page: 3, limit: 2, totalPages: 3 });
  });

  it('lọc status (suy ra ở tầng ứng dụng) xong mới phân trang -> total/slice khớp đúng kết quả đã lọc', async () => {
    const { prisma, upload, findMany } = createMocks();
    findMany.mockResolvedValue([
      activeVoucher({ id: 'active-1' }),
      activeVoucher({ id: 'inactive-1', isActive: false }),
      activeVoucher({ id: 'active-2' }),
      activeVoucher({ id: 'inactive-2', isActive: false }),
      activeVoucher({ id: 'active-3' }),
    ]);
    const service = new VouchersService(prisma, upload);

    const result = await service.findAll({
      status: VoucherStatus.ACTIVE,
      page: 1,
      limit: 2,
    });

    expect(result.data.map((v) => v.id)).toEqual(['active-1', 'active-2']);
    // total=3 (chỉ 3 voucher ACTIVE), không phải 5 (tổng toàn bộ trước khi lọc status).
    expect(result.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
  });
});
