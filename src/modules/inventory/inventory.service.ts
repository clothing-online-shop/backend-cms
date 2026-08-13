import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';

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
            { product: { name: { contains: query.search, mode: 'insensitive' } } },
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
          product: { select: { id: true, name: true, slug: true, thumbnail: true } },
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
}
