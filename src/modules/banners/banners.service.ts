import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Banner, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ListBannersQueryDto } from './dto/list-banners-query.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { ErrorCode } from '../../common/constants/error-codes';
import { BannerStatus } from './banner-status.enum';
import {
  deriveDateRangeStatus,
  assertDateRange,
  isDateInPast,
} from '../../common/utils/date.util';
import { assertImagePublicIdAligned } from '../../common/utils/image-pairing.util';
import {
  buildSkipTake,
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';

export type BannerWithStatus = Banner & { status: BannerStatus };

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(
    query: ListBannersQueryDto,
  ): Promise<{ data: BannerWithStatus[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.BannerWhereInput = {};
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    // Không như Voucher/Collection — banner không có field suy ra (status tính từ
    // startDate/endDate nhưng không dùng để lọc ở findAll() này), where() ở trên đã đủ thu
    // hẹp toàn bộ điều kiện lọc nên phân trang thẳng ở DB được, không cần cắt mảng thủ công.
    const [banners, total] = await this.prisma.$transaction([
      this.prisma.banner.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        ...buildSkipTake(page, limit),
      }),
      this.prisma.banner.count({ where }),
    ]);

    return {
      data: banners.map(withStatus),
      meta: buildPageMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<BannerWithStatus> {
    const banner = await this.findExisting(id);
    return withStatus(banner);
  }

  async create(dto: CreateBannerDto): Promise<BannerWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(dto.startDate);

    // Không mặc định sortOrder về 0 (default của cột) cho mọi banner mới — nếu không, các
    // banner tạo liên tiếp đều cùng sortOrder=0, khiến nút lên/xuống ở FE hoán đổi 2 giá
    // trị giống hệt nhau (no-op nhìn như không hoạt động). Banner mới luôn xếp cuối danh
    // sách hiển thị theo mặc định.
    const sortOrder = dto.sortOrder ?? (await this.resolveNextSortOrder());

    const banner = await this.prisma.banner.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        imagePublicId: dto.imagePublicId,
        linkUrl: dto.linkUrl,
        sortOrder,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    return withStatus(banner);
  }

  async update(id: string, dto: UpdateBannerDto): Promise<BannerWithStatus> {
    assertImagePublicIdAligned(dto.imageUrl, dto.imagePublicId, {
      image: 'imageUrl',
      imagePublicId: 'imagePublicId',
    });
    const existing = await this.findExisting(id);

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

    // Chỉ chặn quá khứ khi startDate THỰC SỰ đổi sang giá trị mới — banner đã RUNNING/ENDED
    // có startDate vốn dĩ đã ở quá khứ (đúng bản chất), sửa field khác (linkUrl, ảnh...) mà
    // vẫn gửi lại nguyên startDate cũ không được vô tình bị chặn.
    const startDateChanged =
      dto.startDate !== undefined &&
      new Date(dto.startDate).getTime() !== existing.startDate.getTime();
    if (startDateChanged) {
      assertStartDateNotInPast(dto.startDate!);
    }

    const imageChanged =
      dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl;

    const updated = await this.prisma.banner.update({
      where: { id },
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl === undefined ? undefined : dto.imageUrl,
        imagePublicId:
          dto.imagePublicId === undefined ? undefined : dto.imagePublicId,
        linkUrl: dto.linkUrl === undefined ? undefined : dto.linkUrl,
        sortOrder: dto.sortOrder,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });

    // Best-effort, chạy SAU khi update DB đã thành công — dọn trước mà update sau đó
    // lỗi thì ảnh cũ đã bị xóa vĩnh viễn trên Cloudinary trong khi DB vẫn còn trỏ tới
    // URL đã chết. Lỗi xóa ảnh cũ ở đây không được chặn response thành công — ảnh mồ
    // côi còn hơn admin tưởng lưu thất bại.
    if (imageChanged && existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }

    return withStatus(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    await this.prisma.banner.delete({ where: { id } });

    if (existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }
  }

  async reorder(dto: ReorderBannersDto): Promise<void> {
    const ids = dto.items.map((item) => item.id);
    const existing = await this.prisma.banner.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException({
        message: 'Có banner không tồn tại trong danh sách sắp xếp',
        code: ErrorCode.BANNER_REORDER_NOT_FOUND,
      });
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.banner.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  private async findExisting(id: string): Promise<Banner> {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) {
      throw new NotFoundException({
        message: 'Không tìm thấy banner',
        code: ErrorCode.BANNER_NOT_FOUND,
      });
    }
    return banner;
  }

  private async resolveNextSortOrder(): Promise<number> {
    const last = await this.prisma.banner.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}

function assertStartDateNotInPast(startDate: string): void {
  if (isDateInPast(startDate)) {
    throw new BadRequestException({
      message: 'Ngày bắt đầu không được ở trong quá khứ.',
      code: ErrorCode.BANNER_START_DATE_IN_PAST,
    });
  }
}

function withStatus(banner: Banner): BannerWithStatus {
  return {
    ...banner,
    status: deriveDateRangeStatus(
      banner.startDate,
      banner.endDate,
    ) as BannerStatus,
  };
}
