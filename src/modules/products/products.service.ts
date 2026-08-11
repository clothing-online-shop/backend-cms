import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Product, ProductVariant } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug, generateSku } from '../../common/utils/slug.util';
import { UploadService } from '../upload/upload.service';
import { ProductStatus } from './product-status.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductVariantDto } from './dto/product-variant.dto';
import { AssignCollectionsDto } from './dto/assign-collections.dto';
import {
  ListProductsQueryDto,
  ProductSort,
} from './dto/list-products-query.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

type Db = Prisma.TransactionClient;
type ProductWithStockVariants = Product & {
  variants: { stockQuantity: number }[];
  // Optional — relatedProducts (findBySlug) không include collections, chỉ findAll() và
  // chính findBySlug() (bản thân sản phẩm đang xem) mới có; toListItem tự fallback [].
  collections?: { collection: { id: string; name: string; slug: string } }[];
};

const RELATED_PRODUCTS_LIMIT = 8;
const DEFAULT_PAGE_LIMIT = 20;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findAll(query: ListProductsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.ProductWhereInput = {};
    // Không dùng `if (query.status)` — ProductStatus.DRAFT giờ là 0 (falsy), filter theo
    // "Chưa mở bán" sẽ bị bỏ qua nhầm như không lọc gì nếu chỉ check truthy.
    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.categoryIds) {
      // FE (cây checkbox 3 trạng thái) đã tự gộp phẳng id các danh mục con khi chọn
      // danh mục cha — khớp thẳng, không tự mở rộng cây con như `category` bên dưới.
      const ids = query.categoryIds.split(',').filter(Boolean);
      if (ids.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      where.categoryId = { in: ids };
    } else if (query.category) {
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

    if (query.collectionIds) {
      where.collections = {
        some: { collectionId: { in: query.collectionIds.split(',') } },
      };
    }

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: resolveOrderBy(query.sort),
        skip: (page - 1) * limit,
        take: limit,
        include: {
          variants: { select: { stockQuantity: true } },
          collections: { include: { collection: true } },
        },
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

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        brand: true,
        variants: true,
        reviews: { orderBy: { createdAt: 'desc' } },
        collections: { include: { collection: true } },
      },
    });

    if (!product) {
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
      imagePublicIds: product.imagePublicIds,
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
      collections: product.collections.map((cp) => ({
        id: cp.collection.id,
        name: cp.collection.name,
        slug: cp.collection.slug,
      })),
    };
  }

  async create(
    dto: CreateProductDto,
  ): Promise<Product & { variants: ProductVariant[] }> {
    assertNoDuplicateVariants(dto.variants);
    await this.assertCategoryExists(dto.categoryId);
    this.assertValidSalePrice(dto.salePrice, dto.basePrice);
    assertImagesPublicIdsAligned(dto.images, dto.imagePublicIds);
    // Dedupe trước khi ghi — client gửi trùng id (double-submit, gọi API thô qua Swagger...)
    // sẽ đụng @@unique([collectionId, productId]) và ném P2002 thô nếu không lọc trước.
    const collectionIds = dto.collectionIds?.length
      ? [...new Set(dto.collectionIds)]
      : undefined;
    if (collectionIds?.length) {
      await this.assertCollectionsExist(collectionIds);
    }

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
        thumbnailPublicId: dto.thumbnailPublicId,
        images: dto.images ?? [],
        imagePublicIds: dto.imagePublicIds ?? [],
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        variants: { create: variantsData },
        collections: collectionIds?.length
          ? {
              create: collectionIds.map((collectionId) => ({
                collectionId,
              })),
            }
          : undefined,
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

    if (dto.categoryId !== undefined) {
      if (!dto.categoryId) {
        throw new BadRequestException('categoryId không được để trống');
      }
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
    assertImagesPublicIdsAligned(dto.images, dto.imagePublicIds);

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
          thumbnailPublicId: dto.thumbnailPublicId,
          images: dto.images,
          imagePublicIds: dto.imagePublicIds,
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

    // Best-effort, chạy SAU khi transaction DB đã commit thành công — dọn trước
    // transaction thì nếu transaction rollback (vd syncVariants ném ConflictException
    // vì biến thể đã có trong đơn hàng), ảnh cũ đã bị xoá vĩnh viễn trên Cloudinary dù
    // update "thất bại", trong khi DB vẫn đang trỏ tới URL đã chết. Lỗi xoá ảnh cũ ở
    // đây không được chặn response thành công — ảnh mồ côi còn hơn admin tưởng lưu
    // thất bại trong khi dữ liệu đã đổi.
    await this.cleanupRemovedProductAssets(existing, dto);

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
    try {
      await this.prisma.product.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Không thể xóa sản phẩm vì đã có biến thể được dùng trong đơn hàng/giỏ hàng',
        );
      }
      throw err;
    }
  }

  // Thay thế TOÀN BỘ danh sách bộ sưu tập của sản phẩm — cùng cách tiếp cận với
  // syncVariants: FE luôn gửi danh sách đầy đủ mong muốn, không phải diff thủ công.
  async assignCollections(
    productId: string,
    dto: AssignCollectionsDto,
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    // Dedupe trước khi ghi — client gửi trùng id sẽ đụng @@unique([collectionId,
    // productId]) và ném P2002 thô nếu không lọc trước.
    const collectionIds = [...new Set(dto.collectionIds)];
    if (collectionIds.length > 0) {
      await this.assertCollectionsExist(collectionIds);
    }

    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { productId } }),
      this.prisma.collectionProduct.createMany({
        data: collectionIds.map((collectionId) => ({
          productId,
          collectionId,
        })),
      }),
    ]);
  }

  async removeFromCollection(
    productId: string,
    collectionId: string,
  ): Promise<void> {
    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { productId, collectionId },
    });
    if (count === 0) {
      throw new NotFoundException('Sản phẩm không thuộc bộ sưu tập này');
    }
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

  private async assertCollectionsExist(collectionIds: string[]): Promise<void> {
    const uniqueIds = new Set(collectionIds);
    const count = await this.prisma.collection.count({
      where: { id: { in: [...uniqueIds] } },
    });
    if (count !== uniqueIds.size) {
      throw new BadRequestException(
        'Có bộ sưu tập không tồn tại trong danh sách gán',
      );
    }
  }

  private async assertCategoryExists(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new BadRequestException('Danh mục không tồn tại');
    }
  }

  private assertValidSalePrice(
    salePrice: number | null | undefined,
    basePrice: number,
  ): void {
    if (salePrice != null && salePrice >= basePrice) {
      throw new BadRequestException('Giá khuyến mãi phải nhỏ hơn giá gốc');
    }
  }

  // Xóa trên Cloudinary các ảnh không còn xuất hiện trong thumbnail/images mới —
  // dựa vào publicId lưu cùng vị trí với images cũ (existing.imagePublicIds[i]
  // là publicId của existing.images[i]) vì DB không có bảng ảnh riêng.
  private async cleanupRemovedProductAssets(
    existing: Product,
    dto: UpdateProductDto,
  ): Promise<void> {
    const removedPublicIds: string[] = [];

    if (
      dto.thumbnail !== undefined &&
      dto.thumbnail !== existing.thumbnail &&
      existing.thumbnailPublicId
    ) {
      removedPublicIds.push(existing.thumbnailPublicId);
    }

    if (dto.images !== undefined) {
      const nextImages = new Set(dto.images);
      existing.images.forEach((url, index) => {
        if (nextImages.has(url)) return;
        const publicId = existing.imagePublicIds[index];
        if (publicId) removedPublicIds.push(publicId);
      });
    }

    await Promise.all(
      removedPublicIds.map((publicId) =>
        this.uploadService.deleteImage(publicId).catch(() => undefined),
      ),
    );
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
      ? generateSku(explicit)
      : generateSku(`${productSlug}-${size}-${color}`);
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

// images[i] và imagePublicIds[i] phải luôn cùng vị trí (DB không có bảng ảnh riêng để
// tra publicId theo url) — nếu 2 mảng lệch độ dài, lần cleanupRemovedProductAssets sau
// sẽ tra publicId sai vị trí, có thể xoá nhầm ảnh đang dùng thật trên Cloudinary.
function assertImagesPublicIdsAligned(
  images: string[] | undefined,
  imagePublicIds: string[] | undefined,
): void {
  if (
    images !== undefined &&
    imagePublicIds !== undefined &&
    images.length !== imagePublicIds.length
  ) {
    throw new BadRequestException(
      'images và imagePublicIds phải có cùng số lượng phần tử',
    );
  }
}

function toListItem(product: ProductWithStockVariants) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    material: product.material,
    thumbnail: product.thumbnail,
    thumbnailPublicId: product.thumbnailPublicId,
    basePrice: product.basePrice.toNumber(),
    salePrice: product.salePrice?.toNumber() ?? null,
    brandId: product.brandId,
    status: product.status,
    categoryId: product.categoryId,
    totalStock: product.variants.reduce((sum, v) => sum + v.stockQuantity, 0),
    collections: (product.collections ?? []).map((cp) => ({
      id: cp.collection.id,
      name: cp.collection.name,
      slug: cp.collection.slug,
    })),
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
