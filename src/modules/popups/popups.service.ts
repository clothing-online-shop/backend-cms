import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Popup, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { UploadService } from '../upload/upload.service';
import { CreatePopupDto } from './dto/create-popup.dto';
import { UpdatePopupDto } from './dto/update-popup.dto';
import { ListPopupsQueryDto } from './dto/list-popups-query.dto';
import { ReorderPopupsDto } from './dto/reorder-popups.dto';
import { ErrorCode } from '../../common/constants/error-codes';
import { PopupStatus } from './popup-status.enum';
import {
  deriveDateRangeStatus,
  assertDateRange,
  assertStartDateNotInPast,
  isDateInPast,
} from '../../common/utils/date.util';
import { assertImagePublicIdAligned } from '../../common/utils/image-pairing.util';
import {
  buildSkipTake,
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';

export type PopupWithStatus = Popup & { status: PopupStatus };

@Injectable()
export class PopupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(
    query: ListPopupsQueryDto,
  ): Promise<{ data: PopupWithStatus[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PopupWhereInput = {};
    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const [popups, total] = await this.prisma.$transaction([
      this.prisma.popup.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        ...buildSkipTake(page, limit),
      }),
      this.prisma.popup.count({ where }),
    ]);

    return {
      data: popups.map(withStatus),
      meta: buildPageMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<PopupWithStatus> {
    const popup = await this.findExisting(id);
    return withStatus(popup);
  }

  async create(dto: CreatePopupDto): Promise<PopupWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(
      dto.startDate,
      isDateInPast,
      ErrorCode.POPUP_START_DATE_IN_PAST,
    );

    // Popup mới luôn xếp cuối danh sách hiển thị theo mặc định — tương tự Banner, xem
    // banners.service.ts.
    const sortOrder = dto.sortOrder ?? (await this.resolveNextSortOrder());

    const popup = await this.prisma.popup.create({
      data: {
        eyebrow: dto.eyebrow,
        title: dto.title,
        description: dto.description,
        discountCode: dto.discountCode,
        imageUrl: dto.imageUrl,
        imagePublicId: dto.imagePublicId,
        ctaLabel: dto.ctaLabel,
        ctaLinkUrl: dto.ctaLinkUrl,
        sortOrder,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    return withStatus(popup);
  }

  async update(id: string, dto: UpdatePopupDto): Promise<PopupWithStatus> {
    assertImagePublicIdAligned(dto.imageUrl, dto.imagePublicId, {
      image: 'imageUrl',
      imagePublicId: 'imagePublicId',
    });
    const existing = await this.findExisting(id);

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

    const startDateChanged =
      dto.startDate !== undefined &&
      new Date(dto.startDate).getTime() !== existing.startDate.getTime();
    if (startDateChanged) {
      assertStartDateNotInPast(
        dto.startDate!,
        isDateInPast,
        ErrorCode.POPUP_START_DATE_IN_PAST,
      );
    }

    const imageChanged =
      dto.imageUrl !== undefined && dto.imageUrl !== existing.imageUrl;

    const updated = await this.prisma.popup.update({
      where: { id },
      data: {
        eyebrow: dto.eyebrow,
        title: dto.title,
        description: dto.description,
        discountCode: dto.discountCode,
        imageUrl: dto.imageUrl === undefined ? undefined : dto.imageUrl,
        imagePublicId:
          dto.imagePublicId === undefined ? undefined : dto.imagePublicId,
        ctaLabel: dto.ctaLabel,
        ctaLinkUrl: dto.ctaLinkUrl,
        sortOrder: dto.sortOrder,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });

    // Best-effort, chạy SAU khi update DB đã thành công — xem lý do ở banners.service.ts.
    if (imageChanged && existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }

    return withStatus(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    await this.prisma.popup.delete({ where: { id } });

    if (existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }
  }

  async reorder(dto: ReorderPopupsDto): Promise<void> {
    const ids = dto.items.map((item) => item.id);
    const existing = await this.prisma.popup.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException({
        message: 'Có popup không tồn tại trong danh sách sắp xếp',
        code: ErrorCode.POPUP_REORDER_NOT_FOUND,
      });
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.popup.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  private async findExisting(id: string): Promise<Popup> {
    const popup = await this.prisma.popup.findUnique({ where: { id } });
    if (!popup) {
      throw new NotFoundException({
        message: 'Không tìm thấy popup',
        code: ErrorCode.POPUP_NOT_FOUND,
      });
    }
    return popup;
  }

  private async resolveNextSortOrder(): Promise<number> {
    const last = await this.prisma.popup.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}

function withStatus(popup: Popup): PopupWithStatus {
  return {
    ...popup,
    status: deriveDateRangeStatus(
      popup.startDate,
      popup.endDate,
    ) as PopupStatus,
  };
}
