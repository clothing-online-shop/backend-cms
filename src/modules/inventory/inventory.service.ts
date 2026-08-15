import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { ImportStockDto } from './dto/import-stock.dto';
import { AdjustStockDto, AdjustStockType } from './dto/adjust-stock.dto';
import { ListStockHistoryQueryDto } from './dto/list-stock-history-query.dto';

const LOW_STOCK_THRESHOLD_KEY = 'lowStockThreshold';
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getLowStockThreshold(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: LOW_STOCK_THRESHOLD_KEY },
    });
    return config ? parseInt(config.value, 10) : DEFAULT_LOW_STOCK_THRESHOLD;
  }

  async setLowStockThreshold(value: number): Promise<number> {
    await this.prisma.systemConfig.upsert({
      where: { key: LOW_STOCK_THRESHOLD_KEY },
      create: { key: LOW_STOCK_THRESHOLD_KEY, value: String(value) },
      update: { value: String(value) },
    });
    return value;
  }

  async findAll(query: ListInventoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const threshold = await this.getLowStockThreshold();

    const searchFilter: Prisma.ProductVariantWhereInput = query.search
      ? {
          OR: [
            { sku: { contains: query.search, mode: 'insensitive' } },
            {
              product: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};

    const where: Prisma.ProductVariantWhereInput = {
      AND: [
        { product: { isDelete: false } },
        query.categoryId ? { product: { categoryId: query.categoryId } } : {},
        query.brandId ? { product: { brandId: query.brandId } } : {},
        query.lowStockOnly ? { stockQuantity: { lte: threshold } } : {},
        searchFilter,
      ],
    };

    const [variants, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        include: {
          product: {
            select: { id: true, name: true, slug: true, thumbnail: true },
          },
        },
        orderBy: { product: { name: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return {
      data: variants.map((variant) => ({
        variantId: variant.id,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        stockQuantity: variant.stockQuantity,
        lowStockThreshold: threshold,
        productId: variant.product.id,
        productName: variant.product.name,
        productSlug: variant.product.slug,
        thumbnail: variant.product.thumbnail,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  // findUnique thường KHÔNG khoá dòng — 2 transaction đồng thời vẫn có thể cùng đọc được
  // stockQuantity cũ trước khi transaction kia commit, khiến điều kiện "không cho âm kho"
  // validate trên dữ liệu đã stale (UPDATE ... increment ở applyMovement() vẫn cộng đúng
  // vì là atomic ở tầng DB, nhưng bản thân điều kiện chặn âm kho thì không còn đáng tin).
  // SELECT ... FOR UPDATE khoá dòng ngay trong transaction hiện tại — transaction thứ 2
  // phải đợi transaction thứ 1 commit xong mới đọc được, lúc đó thấy đúng stockQuantity
  // mới nhất để validate.
  private async lockVariant(
    tx: Prisma.TransactionClient,
    variantId: string,
  ): Promise<{ id: string; stockQuantity: number } | null> {
    const rows = await tx.$queryRaw<{ id: string; stockQuantity: number }[]>`
      SELECT id, "stockQuantity" FROM "product_variants" WHERE id = ${variantId} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  // Ghi 1 movement + cộng dồn tồn kho trong CÙNG 1 transaction. Tách riêng vì
  // import/adjust chỉ khác nhau ở cách tính delta, phần ghi là y hệt nhau.
  private async applyMovement(
    tx: Prisma.TransactionClient,
    params: {
      variantId: string;
      type: StockMovementType;
      delta: number;
      note?: string | null;
      createdById: string;
    },
  ): Promise<void> {
    await tx.stockMovement.create({
      data: {
        productVariantId: params.variantId,
        type: params.type,
        quantity: params.delta,
        note: params.note,
        createdById: params.createdById,
      },
    });
    await tx.productVariant.update({
      where: { id: params.variantId },
      data: { stockQuantity: { increment: params.delta } },
    });
  }

  // Đọc + validate + ghi phải nằm trong cùng transaction: nếu đọc tồn kho ngoài
  // transaction, 2 request đồng thời có thể cùng thấy 1 giá trị cũ và cùng ghi đè,
  // làm tồn kho âm hoặc điều chỉnh không về đúng số đã kiểm kê.
  async import(variantId: string, dto: ImportStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await this.lockVariant(tx, variantId);
      if (!variant) {
        throw new NotFoundException('Không tìm thấy biến thể sản phẩm.');
      }

      await this.applyMovement(tx, {
        variantId,
        type: StockMovementType.IMPORT,
        delta: dto.quantity,
        note: dto.note,
        createdById: userId,
      });

      const updated = await tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      return { stockQuantity: updated.stockQuantity };
    });
  }

  async adjust(variantId: string, dto: AdjustStockDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await this.lockVariant(tx, variantId);
      if (!variant) {
        throw new NotFoundException('Không tìm thấy biến thể sản phẩm.');
      }

      let delta: number;
      let movementType: StockMovementType;

      if (dto.type === AdjustStockType.EXPORT) {
        delta = -dto.quantity!;
        movementType = StockMovementType.EXPORT;
        if (variant.stockQuantity + delta < 0) {
          throw new BadRequestException({
            message: 'Số lượng xuất vượt quá tồn kho hiện có.',
            code: ErrorCode.INVENTORY_EXPORT_EXCEEDS_STOCK,
          });
        }
      } else {
        delta = dto.actualQuantity! - variant.stockQuantity;
        movementType = StockMovementType.ADJUSTMENT;
        if (delta === 0) {
          throw new BadRequestException({
            message:
              'Số tồn thực tế trùng với hệ thống, không có gì để điều chỉnh.',
            code: ErrorCode.INVENTORY_ADJUSTMENT_NO_CHANGE,
          });
        }
      }

      await this.applyMovement(tx, {
        variantId,
        type: movementType,
        delta,
        note: dto.reason,
        createdById: userId,
      });

      const updated = await tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
      });
      return { stockQuantity: updated.stockQuantity };
    });
  }

  async getHistory(query: ListStockHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.StockMovementWhereInput = {
      AND: [
        query.variantId ? { productVariantId: query.variantId } : {},
        query.productId
          ? { productVariant: { productId: query.productId } }
          : {},
        query.type ? { type: query.type } : {},
        query.from ? { createdAt: { gte: new Date(query.from) } } : {},
        query.to ? { createdAt: { lte: toInclusiveEndOfDay(query.to) } } : {},
      ],
    };

    const [movements, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          productVariant: {
            select: {
              sku: true,
              size: true,
              color: true,
              product: { select: { id: true, name: true } },
            },
          },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      data: movements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        quantity: movement.quantity,
        note: movement.note,
        createdAt: movement.createdAt,
        variantId: movement.productVariantId,
        sku: movement.productVariant.sku,
        size: movement.productVariant.size,
        color: movement.productVariant.color,
        productId: movement.productVariant.product.id,
        productName: movement.productVariant.product.name,
        createdByName: movement.createdBy?.fullName ?? 'Hệ thống',
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }
}

// DTO ghi rõ `to` là "lọc tới ngày này" (theo ngày, không phải mốc giờ chính xác) — chuỗi
// ngày thuần "YYYY-MM-DD" phải được hiểu là hết ngày đó, nếu không new Date() sẽ parse ra
// 00:00 UTC và loại luôn gần hết dữ liệu trong đúng ngày được chọn. Chuỗi đã kèm giờ
// (FE hiện đang tự gửi "...T23:59:59.999") thì giữ nguyên, không cộng dồn 2 lần.
function toInclusiveEndOfDay(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999`)
    : new Date(value);
}
