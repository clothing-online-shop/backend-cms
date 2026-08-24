import { Injectable, NotFoundException } from '@nestjs/common';
import { FlashSale, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  deriveDateRangeStatus,
  type DateRangeStatus,
} from '../../common/utils/date.util';
import {
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListFlashSalesQueryDto } from './dto/list-flash-sales-query.dto';

export type FlashSaleListItem = FlashSale & {
  status: DateRangeStatus;
  itemCount: number;
};

export type FlashSaleItemDetail = {
  id: string;
  productVariantId: string;
  salePrice: number;
  quantityLimit: number;
  soldCount: number;
  isSoldOut: boolean;
  product: { id: string; name: string; slug: string; thumbnail: string | null };
  // stockQuantity đi kèm để FE dùng làm mốc validate lại quantityLimit khi sửa (input FE
  // hiện "tối đa X" cạnh field, tránh phải đợi submit rồi mới biết bị chặn ở BE).
  variant: {
    size: string;
    color: string;
    sku: string;
    price: number;
    stockQuantity: number;
  };
};

export type FlashSaleDetail = FlashSale & {
  status: DateRangeStatus;
  items: FlashSaleItemDetail[];
};

const DETAIL_INCLUDE = {
  items: {
    include: {
      productVariant: {
        include: {
          product: {
            select: { id: true, name: true, slug: true, thumbnail: true },
          },
        },
      },
    },
  },
} satisfies Prisma.FlashSaleInclude;

@Injectable()
export class FlashSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListFlashSalesQueryDto,
  ): Promise<{ data: FlashSaleListItem[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.FlashSaleWhereInput = { isDelete: false };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const flashSales = await this.prisma.flashSale.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: { items: true },
    });

    const withStatuses: FlashSaleListItem[] = flashSales.map((fs) => ({
      ...fs,
      status: deriveDateRangeStatus(fs.startDate, fs.endDate),
      itemCount: fs.items.length,
    }));
    // status là field suy ra (không nằm trong DB) nên lọc ở đây, sau khi map, thay vì đưa
    // vào Prisma where() phía trên — cùng lý do/pattern VouchersService.findAll().
    const filtered = query.status
      ? withStatuses.filter((fs) => fs.status === query.status)
      : withStatuses;

    const start = (page - 1) * limit;
    return {
      data: filtered.slice(start, start + limit),
      meta: buildPageMeta(filtered.length, page, limit),
    };
  }

  async findOne(id: string): Promise<FlashSaleDetail> {
    const flashSale = await this.prisma.flashSale.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!flashSale || flashSale.isDelete) {
      throw new NotFoundException({
        message: 'Không tìm thấy đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_NOT_FOUND,
      });
    }
    return toDetail(flashSale);
  }

  // Dùng lại ở Task 7-8 (update/endNow/remove/updateSoldCount) — trả về bản ghi FlashSale
  // TRẦN (không kèm items), đủ để đọc startDate/endDate/isDelete quyết định luật sửa/xóa.
  private async findExisting(id: string): Promise<FlashSale> {
    const flashSale = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!flashSale || flashSale.isDelete) {
      throw new NotFoundException({
        message: 'Không tìm thấy đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_NOT_FOUND,
      });
    }
    return flashSale;
  }
}

type FlashSaleWithDetailInclude = Prisma.FlashSaleGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

function toDetail(flashSale: FlashSaleWithDetailInclude): FlashSaleDetail {
  return {
    ...flashSale,
    status: deriveDateRangeStatus(flashSale.startDate, flashSale.endDate),
    items: flashSale.items.map((item) => ({
      id: item.id,
      productVariantId: item.productVariantId,
      salePrice: item.salePrice.toNumber(),
      quantityLimit: item.quantityLimit,
      soldCount: item.soldCount,
      isSoldOut: item.soldCount >= item.quantityLimit,
      product: {
        id: item.productVariant.product.id,
        name: item.productVariant.product.name,
        slug: item.productVariant.product.slug,
        thumbnail: item.productVariant.product.thumbnail,
      },
      variant: {
        size: item.productVariant.size,
        color: item.productVariant.color,
        sku: item.productVariant.sku,
        price: item.productVariant.price.toNumber(),
        stockQuantity: item.productVariant.stockQuantity,
      },
    })),
  };
}
