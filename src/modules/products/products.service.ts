import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product, ProductStatus, ProductVariant } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductVariantDto } from './dto/product-variant.dto';
import {
  ListProductsQueryDto,
  ProductSort,
} from './dto/list-products-query.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

type Db = Prisma.TransactionClient;
type ProductWithStockVariants = Product & {
  variants: { stockQuantity: number }[];
};

const RELATED_PRODUCTS_LIMIT = 8;
const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListProductsQueryDto, isAdmin: boolean) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.ProductWhereInput = {};
    if (!isAdmin) {
      where.status = ProductStatus.ACTIVE;
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      const categoryIds = await this.resolveCategoryIds(query.category);
      if (categoryIds.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      where.categoryId = { in: categoryIds };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.basePrice = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.size || query.color) {
      where.variants = {
        some: {
          ...(query.size ? { size: { in: query.size.split(',') } } : {}),
          ...(query.color ? { color: { in: query.color.split(',') } } : {}),
        },
      };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        {
          variants: {
            some: { sku: { contains: query.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (query.brandId) {
      where.brandId = query.brandId;
    }

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: resolveOrderBy(query.sort),
        skip: (page - 1) * limit,
        take: limit,
        include: { variants: { select: { stockQuantity: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products.map(toListItem),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findBySlug(slug: string, isAdmin: boolean) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        brand: true,
        variants: true,
        reviews: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!product || (!isAdmin && product.status !== ProductStatus.ACTIVE)) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    const relatedProducts = await this.prisma.product.findMany({
      where: {
        categoryId: product.categoryId,
        id: { not: product.id },
        status: ProductStatus.ACTIVE,
      },
      include: { variants: { select: { stockQuantity: true } } },
      take: RELATED_PRODUCTS_LIMIT,
    });

    return {
      ...toListItem(product),
      description: product.description,
      material: product.material,
      careInstructions: product.careInstructions,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      images: product.images,
      category: {
        id: product.category.id,
        name: product.category.name,
        slug: product.category.slug,
      },
      brand: product.brand
        ? { id: product.brand.id, name: product.brand.name }
        : null,
      variants: product.variants.map(toVariantDto),
      reviews: product.reviews,
      relatedProducts: relatedProducts.map(toListItem),
    };
  }

  async create(
    dto: CreateProductDto,
  ): Promise<Product & { variants: ProductVariant[] }> {
    assertNoDuplicateVariants(dto.variants);
    await this.assertCategoryExists(dto.categoryId);
    this.assertValidSalePrice(dto.salePrice, dto.basePrice);

    const slug = await this.resolveUniqueSlug(dto.slug ?? dto.name);
    const usedSkus = new Set<string>();
    const variantsData: Prisma.ProductVariantCreateWithoutProductInput[] = [];
    for (const variant of dto.variants) {
      const sku = await this.resolveUniqueSku(
        this.prisma,
        variant.sku,
        slug,
        variant.size,
        variant.color,
        usedSkus,
      );
      usedSkus.add(sku);
      variantsData.push({
        size: variant.size,
        color: variant.color,
        sku,
        price: variant.price ?? dto.basePrice,
        stockQuantity: variant.stockQuantity ?? 0,
        imageUrl: variant.imageUrl,
      });
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        material: dto.material,
        careInstructions: dto.careInstructions,
        brandId: dto.brandId,
        categoryId: dto.categoryId,
        basePrice: dto.basePrice,
        salePrice: dto.salePrice,
        status: dto.status ?? ProductStatus.DRAFT,
        thumbnail: dto.thumbnail,
        images: dto.images ?? [],
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        variants: { create: variantsData },
      },
      include: { variants: true },
    });
  }

  async update(
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product & { variants: ProductVariant[] }> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    let slug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      slug = await this.resolveUniqueSlug(dto.slug, id);
    }

    if (dto.variants) {
      assertNoDuplicateVariants(dto.variants);
    }

    const basePrice = dto.basePrice ?? existing.basePrice.toNumber();
    const effectiveSalePrice =
      dto.salePrice !== undefined
        ? dto.salePrice
        : existing.salePrice?.toNumber();
    this.assertValidSalePrice(effectiveSalePrice, basePrice);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          material: dto.material,
          careInstructions: dto.careInstructions,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          basePrice: dto.basePrice,
          salePrice: dto.salePrice,
          status: dto.status,
          thumbnail: dto.thumbnail,
          images: dto.images,
          metaTitle: dto.metaTitle,
          metaDescription: dto.metaDescription,
        },
      });

      if (dto.variants) {
        await this.syncVariants(
          tx,
          id,
          slug,
          basePrice,
          existing.variants,
          dto.variants,
        );
      }
    });

    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: { variants: true },
    });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.INACTIVE },
    });
  }

  async updateVariantStock(
    productId: string,
    variantId: string,
    dto: UpdateStockDto,
  ) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('Không tìm thấy biến thể sản phẩm');
    }

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity: dto.stockQuantity },
    });
  }

  private async syncVariants(
    tx: Db,
    productId: string,
    productSlug: string,
    basePrice: number,
    existingVariants: ProductVariant[],
    incoming: UpdateProductVariantDto[],
  ): Promise<void> {
    const existingIds = new Set(existingVariants.map((v) => v.id));
    const keepIds = new Set<string>();
    const usedSkus = new Set<string>();

    for (const item of incoming) {
      if (item.id) {
        if (!existingIds.has(item.id)) {
          throw new NotFoundException(`Không tìm thấy biến thể ${item.id}`);
        }
        keepIds.add(item.id);
        const current = existingVariants.find((v) => v.id === item.id)!;
        const sku = item.sku
          ? await this.resolveUniqueSku(
              tx,
              item.sku,
              productSlug,
              item.size,
              item.color,
              usedSkus,
              item.id,
            )
          : current.sku;
        usedSkus.add(sku);
        await tx.productVariant.update({
          where: { id: item.id },
          data: {
            size: item.size,
            color: item.color,
            sku,
            price: item.price ?? basePrice,
            stockQuantity: item.stockQuantity ?? 0,
            imageUrl: item.imageUrl,
          },
        });
      } else {
        const sku = await this.resolveUniqueSku(
          tx,
          item.sku,
          productSlug,
          item.size,
          item.color,
          usedSkus,
        );
        usedSkus.add(sku);
        await tx.productVariant.create({
          data: {
            productId,
            size: item.size,
            color: item.color,
            sku,
            price: item.price ?? basePrice,
            stockQuantity: item.stockQuantity ?? 0,
            imageUrl: item.imageUrl,
          },
        });
      }
    }

    const toDelete = existingVariants.filter((v) => !keepIds.has(v.id));
    for (const variant of toDelete) {
      try {
        await tx.productVariant.delete({ where: { id: variant.id } });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2003'
        ) {
          throw new ConflictException(
            `Không thể xóa biến thể ${variant.sku} vì đã được dùng trong đơn hàng/giỏ hàng`,
          );
        }
        throw err;
      }
    }
  }

  private async assertCategoryExists(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new BadRequestException('Danh mục không tồn tại');
    }
  }

  private assertValidSalePrice(
    salePrice: number | undefined,
    basePrice: number,
  ): void {
    if (salePrice !== undefined && salePrice >= basePrice) {
      throw new BadRequestException('Giá khuyến mãi phải nhỏ hơn giá gốc');
    }
  }

  private async resolveCategoryIds(slugOrId: string): Promise<string[]> {
    const category = await this.prisma.category.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
      select: { id: true },
    });
    if (!category) return [];

    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenMap = new Map<string, string[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = childrenMap.get(c.parentId) ?? [];
      list.push(c.id);
      childrenMap.set(c.parentId, list);
    }

    const ids: string[] = [];
    const stack = [category.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      ids.push(current);
      for (const child of childrenMap.get(current) ?? []) stack.push(child);
    }
    return ids;
  }

  private async resolveUniqueSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = generateSlug(source);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.product.findFirst({
        where: {
          slug: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private async resolveUniqueSku(
    db: Db | PrismaService,
    explicit: string | undefined,
    productSlug: string,
    size: string,
    color: string,
    usedInPayload: Set<string>,
    excludeVariantId?: string,
  ): Promise<string> {
    const base = explicit
      ? generateSlug(explicit)
      : generateSlug(`${productSlug}-${size}-${color}`);
    let candidate = base;
    let suffix = 2;

    while (
      usedInPayload.has(candidate) ||
      (await db.productVariant.findFirst({
        where: {
          sku: candidate,
          ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
        },
      }))
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}

function resolveOrderBy(
  sort?: ProductSort,
): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case 'price_asc':
      return { basePrice: 'asc' };
    case 'price_desc':
      return { basePrice: 'desc' };
    case 'best_selling':
      // TODO: cần dữ liệu OrderItem để tính best-selling thật (Sprint 3+), tạm sort theo mới nhất
      return { createdAt: 'desc' };
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
}

function assertNoDuplicateVariants(
  variants: { size: string; color: string }[],
): void {
  const seen = new Set<string>();
  for (const variant of variants) {
    const key = `${variant.size.trim().toLowerCase()}|${variant.color.trim().toLowerCase()}`;
    if (seen.has(key)) {
      throw new BadRequestException(
        `Biến thể trùng lặp: size "${variant.size}" + màu "${variant.color}"`,
      );
    }
    seen.add(key);
  }
}

function toListItem(product: ProductWithStockVariants) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    thumbnail: product.thumbnail,
    basePrice: product.basePrice.toNumber(),
    salePrice: product.salePrice?.toNumber() ?? null,
    brandId: product.brandId,
    status: product.status,
    categoryId: product.categoryId,
    totalStock: product.variants.reduce((sum, v) => sum + v.stockQuantity, 0),
    createdAt: product.createdAt,
  };
}

function toVariantDto(variant: ProductVariant) {
  return {
    id: variant.id,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    price: variant.price.toNumber(),
    stockQuantity: variant.stockQuantity,
    imageUrl: variant.imageUrl,
  };
}
