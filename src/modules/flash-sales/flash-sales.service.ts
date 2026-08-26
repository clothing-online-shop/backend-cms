import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlashSale, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  assertDateRange,
  assertStartDateNotInPast,
  deriveInstantRangeStatus,
  isInstantInPast,
  type DateRangeStatus,
} from '../../common/utils/date.util';
import {
  buildPageMeta,
  type PageMeta,
} from '../../common/utils/pagination.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListFlashSalesQueryDto } from './dto/list-flash-sales-query.dto';
import { FlashSaleItemInputDto } from './dto/flash-sale-item-input.dto';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { UpdateSoldCountDto } from './dto/update-sold-count.dto';
import { AddFlashSaleItemsDto } from './dto/add-flash-sale-items.dto';

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
      include: { _count: { select: { items: true } } },
    });

    // Destructure `_count` ra khỏi phần spread: response chỉ khai báo `itemCount`, không nên
    // rò rỉ nguyên mảng items[] (hoặc field `_count` nội bộ của Prisma) ra API list.
    const withStatuses: FlashSaleListItem[] = flashSales.map(
      ({ _count, ...fs }) => ({
        ...fs,
        status: deriveInstantRangeStatus(fs.startDate, fs.endDate),
        itemCount: _count.items,
      }),
    );
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

  async create(dto: CreateFlashSaleDto): Promise<FlashSaleDetail> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(
      dto.startDate,
      isInstantInPast,
      ErrorCode.FLASH_SALE_START_DATE_IN_PAST,
    );

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    const items = await validateFlashSaleItems(
      this.prisma,
      dto.items,
      startDate,
      endDate,
      null,
    );

    const created = await this.prisma.flashSale.create({
      data: {
        name: dto.name,
        startDate,
        endDate,
        items: { create: items },
      },
    });
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateFlashSaleDto): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveInstantRangeStatus(
      existing.startDate,
      existing.endDate,
    );

    if (status === 'ENDED') {
      throw new ConflictException({
        message: 'Đợt Flash Sale đã kết thúc — không thể chỉnh sửa.',
        code: ErrorCode.FLASH_SALE_UPDATE_BLOCKED_ENDED,
      });
    }
    if (status === 'RUNNING') {
      const attemptingBlockedField =
        dto.name !== undefined ||
        dto.startDate !== undefined ||
        dto.items !== undefined;
      if (attemptingBlockedField) {
        throw new ConflictException({
          message:
            'Đợt Flash Sale đang diễn ra — chỉ có thể sửa ngày kết thúc. Để thêm sản phẩm, dùng POST /flash-sales/:id/items.',
          code: ErrorCode.FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING,
        });
      }
    }

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);
    if (status === 'UPCOMING' && dto.startDate) {
      assertStartDateNotInPast(
        dto.startDate,
        isInstantInPast,
        ErrorCode.FLASH_SALE_START_DATE_IN_PAST,
      );
    }

    if (dto.items) {
      const items = await validateFlashSaleItems(
        this.prisma,
        dto.items,
        new Date(startDate),
        new Date(endDate),
        id,
      );
      await this.prisma.$transaction([
        this.prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } }),
        this.prisma.flashSale.update({
          where: { id },
          data: {
            name: dto.name,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            items: { create: items },
          },
        }),
      ]);
    } else {
      // Không đổi items nhưng NGÀY có thể đổi (RUNNING chỉ cho sửa endDate, UPCOMING cho sửa
      // cả startDate/endDate) — phải re-check overlap của các item HIỆN CÓ với khung giờ MỚI,
      // nếu không: kéo dài endDate của 1 campaign đang RUNNING (hoặc dời khung giờ UPCOMING)
      // có thể khiến biến thể của nó chồng lấn với 1 campaign khác mà không ai validate lại.
      const existingItems = await this.prisma.flashSaleItem.findMany({
        where: { flashSaleId: id },
      });
      if (existingItems.length > 0) {
        await assertNoVariantOverlap(
          this.prisma,
          existingItems.map((item) => item.productVariantId),
          new Date(startDate),
          new Date(endDate),
          id,
        );
      }
      await this.prisma.flashSale.update({
        where: { id },
        data: {
          name: dto.name,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });
    }

    return this.findOne(id);
  }

  async endNow(id: string): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveInstantRangeStatus(
      existing.startDate,
      existing.endDate,
    );
    if (status !== 'RUNNING') {
      throw new ConflictException({
        message: 'Chỉ có thể kết thúc sớm đợt đang diễn ra.',
        code: ErrorCode.FLASH_SALE_END_NOW_NOT_RUNNING,
      });
    }
    await this.prisma.flashSale.update({
      where: { id },
      data: { endDate: new Date() },
    });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    const status = deriveInstantRangeStatus(
      existing.startDate,
      existing.endDate,
    );
    if (status === 'RUNNING') {
      throw new ConflictException({
        message: 'Không thể xóa đợt Flash Sale đang diễn ra.',
        code: ErrorCode.FLASH_SALE_DELETE_BLOCKED_RUNNING,
      });
    }
    // CHỈ soft-delete FlashSale — không đụng tới FlashSaleItem (đặc biệt soldCount, số liệu
    // báo cáo đã bán được bao nhiêu theo từng SKU của 1 đợt ĐÃ ENDED). Trước đây hard-delete
    // cả items ở đây khiến xóa 1 đợt đã chạy xong xóa mất luôn lịch sử bán hàng — items của
    // đợt đã soft-delete tự nhiên không truy cập được qua findAll()/findOne() (đều lọc
    // isDelete: false) nên không cần dọn thêm, giữ lại vô hại và có sẵn cho báo cáo sau này.
    await this.prisma.flashSale.update({
      where: { id },
      data: { isDelete: true },
    });
  }

  async updateSoldCount(
    id: string,
    itemId: string,
    dto: UpdateSoldCountDto,
  ): Promise<FlashSaleDetail> {
    const item = await this.prisma.flashSaleItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.flashSaleId !== id) {
      throw new NotFoundException({
        message: 'Không tìm thấy sản phẩm trong đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_ITEM_NOT_FOUND,
      });
    }
    if (dto.soldCount > item.quantityLimit) {
      throw new BadRequestException({
        message: `Số đã bán không được vượt quá giới hạn (${item.quantityLimit}).`,
        code: ErrorCode.FLASH_SALE_SOLD_COUNT_EXCEEDS_LIMIT,
      });
    }
    await this.prisma.flashSaleItem.update({
      where: { id: itemId },
      data: { soldCount: dto.soldCount },
    });
    return this.findOne(id);
  }

  async addItems(
    id: string,
    dto: AddFlashSaleItemsDto,
  ): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveInstantRangeStatus(
      existing.startDate,
      existing.endDate,
    );
    if (status !== 'RUNNING') {
      throw new ConflictException({
        message: 'Chỉ có thể thêm sản phẩm vào đợt Flash Sale đang diễn ra.',
        code: ErrorCode.FLASH_SALE_ADD_ITEMS_NOT_RUNNING,
      });
    }

    // excludeFlashSaleId: null (không loại trừ chính campaign này) — khác nhánh update()'s
    // items-branch (dùng id chính nó để loại trừ, vì lúc đó item cũ đã bị xóa trước khi validate).
    // Ở đây item cũ KHÔNG bị xóa, nên overlap-check phải tự nhiên bắt được cả trường hợp thêm
    // lại 1 biến thể đã có sẵn trong chính campaign này.
    const items = await validateFlashSaleItems(
      this.prisma,
      dto.items,
      existing.startDate,
      existing.endDate,
      null,
    );

    // CHỈ createMany — không có bước deleteMany nào, khác hẳn update()'s items-branch (vốn
    // thay thế toàn bộ). Đây là điểm cốt lõi của toàn bộ tính năng: "chỉ được cộng thêm".
    //
    // validateFlashSaleItems() ở trên là 1 lần đọc "lạc quan" — 2 request POST /items cùng gửi
    // đúng 1 productVariantId gần như đồng thời có thể cùng vượt qua validate rồi cùng chạm
    // tới đây, request thua sẽ vi phạm @@unique([flashSaleId, productVariantId]) ở DB. Không
    // bắt riêng thì lỗi P2002 thô sẽ rơi thẳng vào AllExceptionsFilter, trả về 500 chung chung
    // (không có field `code` để FE map thông báo) và bắn nhầm 1 alert Sentry cho 1 tình huống
    // không phải lỗi hệ thống — bắt riêng ở đây để trả đúng 409 có code, giống cách
    // ProductsService xử lý P2003 khi xóa variant đang bị ràng buộc.
    try {
      await this.prisma.flashSaleItem.createMany({
        data: items.map((item) => ({ ...item, flashSaleId: id })),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          message: 'Biến thể đã có trong đợt Flash Sale này.',
          code: ErrorCode.FLASH_SALE_VARIANT_OVERLAP,
        });
      }
      throw err;
    }

    return this.findOne(id);
  }

  // Dùng chung cho mọi method cần biết trạng thái hiện tại trước khi ghi (update/endNow/
  // remove/updateSoldCount/addItems) — trả về bản ghi FlashSale TRẦN (không kèm items), đủ để
  // đọc startDate/endDate/isDelete quyết định luật sửa/xóa/thêm.
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
    status: deriveInstantRangeStatus(flashSale.startDate, flashSale.endDate),
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

export async function validateFlashSaleItems(
  prisma: Pick<Prisma.TransactionClient, 'productVariant' | 'flashSaleItem'>,
  items: FlashSaleItemInputDto[],
  startDate: Date,
  endDate: Date,
  excludeFlashSaleId: string | null,
): Promise<
  {
    productVariantId: string;
    salePrice: Prisma.Decimal;
    quantityLimit: number;
  }[]
> {
  const variantIds = items.map((item) => item.productVariantId);

  // Cùng 1 biến thể xuất hiện 2 lần trong 1 payload sẽ vi phạm unique
  // (flashSaleId, productVariantId) ở tầng DB và bung ra lỗi 500 — chặn sớm ở đây với 400 rõ
  // nghĩa. Check trùng NỘI BỘ payload này khác với assertNoVariantOverlap() (trùng với
  // campaign KHÁC), nên phải làm riêng.
  const uniqueVariantIds = new Set(variantIds);
  if (uniqueVariantIds.size !== variantIds.length) {
    throw new BadRequestException({
      message: 'Danh sách sản phẩm có biến thể bị trùng lặp.',
      code: ErrorCode.FLASH_SALE_DUPLICATE_VARIANT,
    });
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const item of items) {
    const variant = variantById.get(item.productVariantId);
    if (!variant) {
      throw new BadRequestException({
        message: 'Không tìm thấy biến thể sản phẩm.',
        code: ErrorCode.FLASH_SALE_VARIANT_NOT_FOUND,
      });
    }
    if (item.salePrice >= variant.price.toNumber()) {
      throw new BadRequestException({
        message: `Giá sale phải nhỏ hơn giá gốc (${variant.price.toString()}).`,
        code: ErrorCode.FLASH_SALE_INVALID_SALE_PRICE,
      });
    }
    if (item.quantityLimit > variant.stockQuantity) {
      throw new BadRequestException({
        message: `Số lượng giới hạn không được vượt quá tồn kho hiện tại (${variant.stockQuantity}).`,
        code: ErrorCode.FLASH_SALE_QUANTITY_EXCEEDS_STOCK,
      });
    }
  }

  await assertNoVariantOverlap(
    prisma,
    variantIds,
    startDate,
    endDate,
    excludeFlashSaleId,
  );

  return items.map((item) => ({
    productVariantId: item.productVariantId,
    salePrice: new Prisma.Decimal(item.salePrice),
    quantityLimit: item.quantityLimit,
  }));
}

// Tách riêng từ validateFlashSaleItems() để dùng lại khi update() chỉ đổi khung giờ
// (startDate/endDate) mà KHÔNG đổi items — trường hợp đó vẫn phải re-check trùng biến thể
// với khung giờ MỚI (kéo dài/dời campaign có thể tạo overlap mới với campaign khác), nhưng
// KHÔNG được re-check giá/tồn kho (item cũ vốn đã hợp lệ, không có lý do bất ngờ từ chối 1
// thao tác "chỉ sửa ngày" vì giá gốc/tồn kho biến thể đổi ở nơi khác từ lúc đó).
async function assertNoVariantOverlap(
  prisma: Pick<Prisma.TransactionClient, 'flashSaleItem'>,
  variantIds: string[],
  startDate: Date,
  endDate: Date,
  excludeFlashSaleId: string | null,
): Promise<void> {
  // Chặn trùng biến thể: tìm FlashSaleItem khác (loại trừ chính campaign đang sửa) cho cùng
  // biến thể, mà FlashSale cha CHƯA ENDED (endDate >= now) VÀ khung giờ giao nhau với
  // [startDate, endDate] mới. 3 điều kiện đều nằm trên field `endDate`/`startDate` của
  // flashSale nên PHẢI gộp bằng AND — không viết trùng key `endDate` 2 lần trong cùng object
  // (object literal sẽ ghi đè lẫn nhau, chỉ giữ lại điều kiện viết sau).
  const now = new Date();
  const overlapping = await prisma.flashSaleItem.findMany({
    where: {
      productVariantId: { in: variantIds },
      ...(excludeFlashSaleId
        ? { flashSaleId: { not: excludeFlashSaleId } }
        : {}),
      flashSale: {
        isDelete: false,
        AND: [
          { endDate: { gte: now } },
          { startDate: { lte: endDate } },
          { endDate: { gte: startDate } },
        ],
      },
    },
    include: {
      flashSale: { select: { name: true } },
      productVariant: { select: { sku: true } },
    },
  });
  if (overlapping.length > 0) {
    const first = overlapping[0];
    throw new ConflictException({
      message: `Biến thể (SKU: ${first.productVariant.sku}) đã tham gia đợt Flash Sale "${first.flashSale.name}" trong cùng khoảng thời gian.`,
      code: ErrorCode.FLASH_SALE_VARIANT_OVERLAP,
    });
  }
}
