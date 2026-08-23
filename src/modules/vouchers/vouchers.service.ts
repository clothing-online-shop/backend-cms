import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType, Prisma, Voucher } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';
import { ErrorCode } from '../../common/constants/error-codes';
import { VoucherStatus } from './voucher-status.enum';
import { assertDateRange } from '../../common/utils/date.util';

export type VoucherWithStatus = Voucher & { status: VoucherStatus };

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListVouchersQueryDto): Promise<VoucherWithStatus[]> {
    const where: Prisma.VoucherWhereInput = {};
    if (query.search) {
      where.code = { contains: query.search, mode: 'insensitive' };
    }

    const vouchers = await this.prisma.voucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const withStatuses = vouchers.map(withStatus);
    // status suy ra từ nhiều field (isActive/startsAt/expiresAt/usageLimit) chứ không phải
    // 1 cột đơn — lọc ở tầng ứng dụng sau khi tính, không dịch được thành 1 mệnh đề where().
    return query.status
      ? withStatuses.filter((v) => v.status === query.status)
      : withStatuses;
  }

  async findOne(id: string): Promise<VoucherWithStatus> {
    return withStatus(await this.findExisting(id));
  }

  async create(dto: CreateVoucherDto): Promise<VoucherWithStatus> {
    const code = normalizeCode(dto.code);
    this.assertValidDiscountFields(
      dto.discountType,
      dto.discountValue,
      dto.maxDiscountAmount,
    );
    if (dto.startsAt && dto.expiresAt) {
      assertDateRange(dto.startsAt, dto.expiresAt);
    }
    await this.assertCodeNotTaken(code);

    const voucher = await this.prisma.voucher.create({
      data: {
        code,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderValue: dto.minOrderValue ?? 0,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        isActive: dto.isActive ?? true,
      },
    });
    return withStatus(voucher);
  }

  async update(id: string, dto: UpdateVoucherDto): Promise<VoucherWithStatus> {
    const existing = await this.findExisting(id);

    const discountType = dto.discountType ?? existing.discountType;
    const discountValue =
      dto.discountValue ?? existing.discountValue.toNumber();
    const maxDiscountAmount =
      dto.maxDiscountAmount !== undefined
        ? dto.maxDiscountAmount
        : (existing.maxDiscountAmount?.toNumber() ?? undefined);
    this.assertValidDiscountFields(
      discountType,
      discountValue,
      maxDiscountAmount,
    );

    const startsAt = dto.startsAt ?? existing.startsAt?.toISOString();
    const expiresAt = dto.expiresAt ?? existing.expiresAt?.toISOString();
    if (startsAt && expiresAt) {
      assertDateRange(startsAt, expiresAt);
    }

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        // maxDiscountAmount có thể cần xóa về null khi đổi discountType sang FIXED_AMOUNT
        // (không dùng `?? undefined` — sẽ bỏ qua field thay vì xóa giá trị cũ trong DB).
        maxDiscountAmount:
          dto.discountType === DiscountType.FIXED_AMOUNT
            ? null
            : dto.maxDiscountAmount,
        minOrderValue: dto.minOrderValue,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        isActive: dto.isActive,
      },
    });
    return withStatus(updated);
  }

  async toggleActive(id: string): Promise<VoucherWithStatus> {
    const existing = await this.findExisting(id);
    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
    return withStatus(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    if (existing.usedCount > 0) {
      throw new ConflictException({
        message:
          'Voucher đã có lượt sử dụng, không thể xóa — hãy vô hiệu hóa thay vì xóa.',
        code: ErrorCode.VOUCHER_HAS_BEEN_USED,
      });
    }
    await this.prisma.voucher.delete({ where: { id } });
  }

  private assertValidDiscountFields(
    discountType: DiscountType,
    discountValue: number,
    maxDiscountAmount: number | undefined,
  ): void {
    if (discountType === DiscountType.PERCENTAGE && discountValue > 100) {
      throw new ConflictException({
        message: 'Giá trị giảm theo % phải trong khoảng 0-100.',
        code: ErrorCode.VOUCHER_INVALID_DISCOUNT_VALUE,
      });
    }
    if (
      discountType === DiscountType.FIXED_AMOUNT &&
      maxDiscountAmount !== undefined
    ) {
      throw new ConflictException({
        message:
          'Trần số tiền giảm chỉ áp dụng cho voucher giảm theo phần trăm.',
        code: ErrorCode.VOUCHER_MAX_DISCOUNT_NOT_APPLICABLE,
      });
    }
  }

  private async assertCodeNotTaken(code: string): Promise<void> {
    const existing = await this.prisma.voucher.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Mã voucher đã tồn tại.',
        code: ErrorCode.VOUCHER_CODE_DUPLICATE,
      });
    }
  }

  private async findExisting(id: string): Promise<Voucher> {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) {
      throw new NotFoundException({
        message: 'Không tìm thấy voucher.',
        code: ErrorCode.VOUCHER_NOT_FOUND,
      });
    }
    return voucher;
  }
}

// Mã voucher khách nhập tay lúc checkout — chuẩn hóa hoa toàn bộ + bỏ khoảng trắng thừa 2
// đầu để "summer2026" và "SUMMER2026 " cùng khớp 1 voucher, tránh tạo trùng vì khác cách gõ.
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function withStatus(voucher: Voucher): VoucherWithStatus {
  return { ...voucher, status: deriveVoucherStatus(voucher) };
}

function deriveVoucherStatus(voucher: Voucher): VoucherStatus {
  if (!voucher.isActive) return VoucherStatus.INACTIVE;

  const now = new Date();
  if (voucher.startsAt && now < voucher.startsAt) return VoucherStatus.UPCOMING;
  if (voucher.expiresAt && now > voucher.expiresAt)
    return VoucherStatus.EXPIRED;
  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return VoucherStatus.OUT_OF_USAGE;
  }
  return VoucherStatus.ACTIVE;
}
