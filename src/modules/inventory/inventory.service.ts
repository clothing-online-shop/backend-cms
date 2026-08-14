import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
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

  async import(variantId: string, dto: ImportStockDto, userId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) {
      throw new NotFoundException('Không tìm thấy biến thể sản phẩm.');
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.stockMovement.create({
        data: {
          productVariantId: variantId,
          type: StockMovementType.IMPORT,
          quantity: dto.quantity,
          note: dto.note,
          createdById: userId,
        },
      }),
      this.prisma.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: { increment: dto.quantity } },
      }),
    ]);

    return { stockQuantity: updated.stockQuantity };
  }

  async adjust(variantId: string, dto: AdjustStockDto, userId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) {
      throw new NotFoundException('Không tìm thấy biến thể sản phẩm.');
    }

    let delta: number;
    let movementType: StockMovementType;

    if (dto.type === AdjustStockType.EXPORT) {
      delta = -dto.quantity!;
      movementType = StockMovementType.EXPORT;
      if (variant.stockQuantity + delta < 0) {
        throw new BadRequestException(
          'Số lượng xuất vượt quá tồn kho hiện có.',
        );
      }
    } else {
      delta = dto.actualQuantity! - variant.stockQuantity;
      movementType = StockMovementType.ADJUSTMENT;
      if (delta === 0) {
        throw new BadRequestException(
          'Số tồn thực tế trùng với hệ thống, không có gì để điều chỉnh.',
        );
      }
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.stockMovement.create({
        data: {
          productVariantId: variantId,
          type: movementType,
          quantity: delta,
          note: dto.reason,
          createdById: userId,
        },
      }),
      this.prisma.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: { increment: delta } },
      }),
    ]);

    return { stockQuantity: updated.stockQuantity };
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
        query.to ? { createdAt: { lte: new Date(query.to) } } : {},
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
