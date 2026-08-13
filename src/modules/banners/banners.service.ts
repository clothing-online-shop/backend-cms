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
import { BannerStatus } from './banner-status.enum';

export type BannerWithStatus = Banner & { status: BannerStatus };

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(query: ListBannersQueryDto): Promise<BannerWithStatus[]> {
    const where: Prisma.BannerWhereInput = {};
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const banners = await this.prisma.banner.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return banners.map(withStatus);
  }

  async findOne(id: string): Promise<BannerWithStatus> {
    const banner = await this.findExisting(id);
    return withStatus(banner);
  }

  async create(dto: CreateBannerDto): Promise<BannerWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);

    const banner = await this.prisma.banner.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        imagePublicId: dto.imagePublicId,
        linkUrl: dto.linkUrl,
        sortOrder: dto.sortOrder,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    return withStatus(banner);
  }

  async update(id: string, dto: UpdateBannerDto): Promise<BannerWithStatus> {
    assertImagePublicIdAligned(dto.imageUrl, dto.imagePublicId);
    const existing = await this.findExisting(id);

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

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
      throw new BadRequestException(
        'Có banner không tồn tại trong danh sách sắp xếp',
      );
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
      throw new NotFoundException('Không tìm thấy banner');
    }
    return banner;
  }
}

function assertImagePublicIdAligned(
  imageUrl: string | undefined,
  imagePublicId: string | undefined,
): void {
  if ((imageUrl !== undefined) !== (imagePublicId !== undefined)) {
    throw new BadRequestException(
      'imageUrl và imagePublicId phải được gửi cùng nhau',
    );
  }
}

function assertDateRange(startDate: string, endDate: string): void {
  if (new Date(endDate) < new Date(startDate)) {
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }
}

// So sánh theo ngày lịch (bỏ qua giờ) để banner kết thúc "hôm nay" vẫn coi là RUNNING
// tới hết ngày, thay vì rơi sang ENDED ngay từ 00:00.
function toDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function withStatus(banner: Banner): BannerWithStatus {
  const today = toDateOnly(new Date());
  const start = toDateOnly(banner.startDate);
  const end = toDateOnly(banner.endDate);

  let status: BannerStatus;
  if (today < start) {
    status = BannerStatus.UPCOMING;
  } else if (today > end) {
    status = BannerStatus.ENDED;
  } else {
    status = BannerStatus.RUNNING;
  }

  return { ...banner, status };
}
