import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PromoBar, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { CreatePromoBarDto } from './dto/create-promo-bar.dto';
import { UpdatePromoBarDto } from './dto/update-promo-bar.dto';
import { ListPromoBarQueryDto } from './dto/list-promo-bar-query.dto';
import { ReorderPromoBarDto } from './dto/reorder-promo-bar.dto';
import { ErrorCode } from '../../common/constants/error-codes';
import { PromoBarStatus } from './promo-bar-status.enum';
import {
  deriveDateRangeStatus,
  assertDateRange,
  assertStartDateNotInPast,
  isDateInPast,
} from '../../common/utils/date.util';
import {
  buildSkipTake,
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';

export type PromoBarWithStatus = PromoBar & { status: PromoBarStatus };

@Injectable()
export class PromoBarsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListPromoBarQueryDto,
  ): Promise<{ data: PromoBarWithStatus[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PromoBarWhereInput = {};
    if (query.search) {
      where.label = { contains: query.search, mode: 'insensitive' };
    }

    const [promoBars, total] = await this.prisma.$transaction([
      this.prisma.promoBar.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        ...buildSkipTake(page, limit),
      }),
      this.prisma.promoBar.count({ where }),
    ]);

    return {
      data: promoBars.map(withStatus),
      meta: buildPageMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<PromoBarWithStatus> {
    const promoBar = await this.findExisting(id);
    return withStatus(promoBar);
  }

  async create(dto: CreatePromoBarDto): Promise<PromoBarWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(
      dto.startDate,
      isDateInPast,
      ErrorCode.PROMO_BAR_START_DATE_IN_PAST,
    );

    // Thanh mới luôn xếp cuối danh sách hiển thị theo mặc định — tương tự Banner/Popup, xem
    // banners.service.ts.
    const sortOrder = dto.sortOrder ?? (await this.resolveNextSortOrder());

    const promoBar = await this.prisma.promoBar.create({
      data: {
        label: dto.label,
        highlight: dto.highlight,
        linkUrl: dto.linkUrl,
        sortOrder,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
    return withStatus(promoBar);
  }

  async update(
    id: string,
    dto: UpdatePromoBarDto,
  ): Promise<PromoBarWithStatus> {
    const existing = await this.findExisting(id);

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

    // Chỉ chặn quá khứ khi startDate THỰC SỰ đổi sang giá trị mới — xem lý do ở
    // banners.service.ts.
    const startDateChanged =
      dto.startDate !== undefined &&
      new Date(dto.startDate).getTime() !== existing.startDate.getTime();
    if (startDateChanged) {
      assertStartDateNotInPast(
        dto.startDate!,
        isDateInPast,
        ErrorCode.PROMO_BAR_START_DATE_IN_PAST,
      );
    }

    const updated = await this.prisma.promoBar.update({
      where: { id },
      data: {
        label: dto.label,
        highlight: dto.highlight,
        linkUrl: dto.linkUrl,
        sortOrder: dto.sortOrder,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });

    return withStatus(updated);
  }

  async remove(id: string): Promise<void> {
    await this.findExisting(id);
    await this.prisma.promoBar.delete({ where: { id } });
  }

  async reorder(dto: ReorderPromoBarDto): Promise<void> {
    const ids = dto.items.map((item) => item.id);
    const existing = await this.prisma.promoBar.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException({
        message: 'Có thanh khuyến mãi không tồn tại trong danh sách sắp xếp',
        code: ErrorCode.PROMO_BAR_REORDER_NOT_FOUND,
      });
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.promoBar.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  private async findExisting(id: string): Promise<PromoBar> {
    const promoBar = await this.prisma.promoBar.findUnique({ where: { id } });
    if (!promoBar) {
      throw new NotFoundException({
        message: 'Không tìm thấy thanh khuyến mãi',
        code: ErrorCode.PROMO_BAR_NOT_FOUND,
      });
    }
    return promoBar;
  }

  private async resolveNextSortOrder(): Promise<number> {
    const last = await this.prisma.promoBar.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }
}

function withStatus(promoBar: PromoBar): PromoBarWithStatus {
  return {
    ...promoBar,
    status: deriveDateRangeStatus(
      promoBar.startDate,
      promoBar.endDate,
    ) as PromoBarStatus,
  };
}
