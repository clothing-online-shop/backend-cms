import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType, Prisma, Voucher } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';
import { ErrorCode } from '../../common/constants/error-codes';
import { VoucherStatus } from './voucher-status.enum';
import { assertDateRange } from '../../common/utils/date.util';
import { assertImagePublicIdAligned } from '../../common/utils/image-pairing.util';

export type VoucherWithStatus = Voucher & { status: VoucherStatus };

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(query: ListVouchersQueryDto): Promise<VoucherWithStatus[]> {
    const where: Prisma.VoucherWhereInput = {};
    if (query.search) {
      where.code = { contains: query.search, mode: 'insensitive' };
    }
    if (query.discountType) {
      where.discountType = query.discountType;
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
    if (dto.expiresAt) {
      assertDateRange(dto.startsAt, dto.expiresAt);
    }
    await this.assertCodeNotTaken(code);

    const voucher = await this.prisma.voucher.create({
      data: {
        code,
        imageUrl: dto.imageUrl,
        imagePublicId: dto.imagePublicId,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderValue: dto.minOrderValue ?? 0,
        startsAt: new Date(dto.startsAt),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        isActive: dto.isActive ?? true,
      },
    });
    return withStatus(voucher);
  }

  async update(id: string, dto: UpdateVoucherDto): Promise<VoucherWithStatus> {
    assertImagePublicIdAligned(dto.imageUrl, dto.imagePublicId, {
      image: 'imageUrl',
      imagePublicId: 'imagePublicId',
    });
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

    const startsAt = dto.startsAt ?? existing.startsAt.toISOString();
    const expiresAt = dto.expiresAt ?? existing.expiresAt?.toISOString();
    if (expiresAt) {
      assertDateRange(startsAt, expiresAt);
    }

    const imageChanged =
      dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl;

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
        // undefined = giữ nguyên ảnh cũ; null = admin chủ động gỡ ảnh; string = ảnh mới.
        imageUrl:
          dto.imageUrl === undefined ? undefined : (dto.imageUrl ?? null),
        imagePublicId:
          dto.imagePublicId === undefined
            ? undefined
            : (dto.imagePublicId ?? null),
      },
    });

    // Best-effort, chạy SAU khi update DB đã thành công — dọn trước mà update sau đó lỗi
    // thì ảnh cũ đã bị xóa vĩnh viễn trên Cloudinary trong khi DB vẫn còn trỏ tới URL đã
    // chết (giống BannersService.update()).
    if (imageChanged && existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }

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

    if (existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }
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

// Chỉ 2 trạng thái hiển thị (theo yêu cầu) — ACTIVE nghĩa là "dùng được ngay bây giờ", mọi
// lý do khác (tắt tay, chưa tới ngày, đã hết hạn, đã hết lượt) đều gộp INACTIVE. Chi tiết lý
// do cụ thể vẫn xem được qua startsAt/expiresAt/usageLimit hiển thị riêng ở FE, không mất
// thông tin so với bản có 5 trạng thái trước đây.
function deriveVoucherStatus(voucher: Voucher): VoucherStatus {
  if (!voucher.isActive) return VoucherStatus.INACTIVE;

  const now = new Date();
  if (now < voucher.startsAt) return VoucherStatus.INACTIVE;
  if (voucher.expiresAt && now > voucher.expiresAt)
    return VoucherStatus.INACTIVE;
  if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
    return VoucherStatus.INACTIVE;
  }
  return VoucherStatus.ACTIVE;
}
