import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Product,
  ProductVariant,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug, generateSku } from '../../common/utils/slug.util';
import { diffNewlyAdded } from '../../common/utils/diff.util';
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
import { ErrorCode } from '../../common/constants/error-codes';
import { isCollectionEnded } from '../collections/collection-status.util';

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

    const where: Prisma.ProductWhereInput = { isDelete: false };
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

    if (!product || product.isDelete) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    const relatedProducts = await this.prisma.product.findMany({
      where: {
        categoryId: product.categoryId,
        id: { not: product.id },
        status: ProductStatus.ACTIVE,
        isDelete: false,
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
    userId: string,
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
      // Sản phẩm mới tạo, chưa có collection nào trước đó — mọi id trong danh sách đều
      // là "mới thêm", nên check ENDED/ACTIVE áp dụng cho toàn bộ.
      const endDateByCollectionId =
        await this.assertCollectionsExist(collectionIds);
      this.assertNoEndedCollections(endDateByCollectionId, collectionIds);
      this.assertActiveIfAddingCollections(
        dto.status ?? ProductStatus.DRAFT,
        collectionIds,
      );
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

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
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

      // Mở sổ kho cho tồn kho ban đầu ngay lúc tạo — nếu không, biến thể có tồn > 0 mà
      // lịch sử kho (StockMovement) lại trống trơn, không có điểm bắt đầu để đối chiếu.
      const openingStockVariants = product.variants.filter(
        (v) => v.stockQuantity > 0,
      );
      if (openingStockVariants.length > 0) {
        await tx.stockMovement.createMany({
          data: openingStockVariants.map((v) => ({
            productVariantId: v.id,
            type: StockMovementType.IMPORT,
            quantity: v.stockQuantity,
            note: 'Tồn kho khởi tạo khi tạo sản phẩm',
            createdById: userId,
          })),
        });
      }

      return product;
    });
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    userId: string,
  ): Promise<Product & { variants: ProductVariant[] }> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    // Đã xóa mềm coi như không tồn tại — không cho sửa 1 sản phẩm đã xóa, khớp
    // assertCategoryExists() ở categories.service.ts / findExisting() ở collections.service.ts.
    if (!existing || existing.isDelete) {
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
      // updateMany (không phải update) + check isDelete:false ngay trong where — chặn race
      // giữa lúc đọc existing ở trên và lúc ghi ở đây: nếu sản phẩm bị xóa mềm bởi 1
      // request khác đúng trong khoảng đó, update thường (chỉ where: {id}) vẫn ghi đè bình
      // thường, coi như "hồi sinh" 1 bản ghi lẽ ra phải đóng băng sau khi xóa (cùng cách đã
      // hardening cho Category, xem categories.service.ts update()).
      const { count } = await tx.product.updateMany({
        where: { id, isDelete: false },
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
      if (count === 0) {
        throw new NotFoundException('Không tìm thấy sản phẩm');
      }

      // Đổi status sang DRAFT/INACTIVE — tự gỡ khỏi mọi bộ sưu tập đang gán, khớp lý do
      // chặn gán mới ở assertActiveIfAddingCollections(): 1 bộ sưu tập dùng để quảng bá/
      // trưng bày trên storefront không nên chứa sản phẩm nháp/ngừng kinh doanh. FE đã tự
      // confirm với admin trước khi gửi request này (xem ProductForm.tsx handleSaveStep()),
      // nên ở đây cứ thực hiện luôn, không hỏi lại.
      if (dto.status !== undefined && dto.status !== ProductStatus.ACTIVE) {
        await tx.collectionProduct.deleteMany({ where: { productId: id } });
      }

      if (dto.variants) {
        await this.syncVariants(
          tx,
          id,
          slug,
          basePrice,
          existing.variants,
          dto.variants,
          userId,
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
    if (!existing || existing.isDelete) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }

    // Xóa mềm — trước đây xóa cứng nhưng variant đã dùng trong đơn hàng/giỏ hàng thì bị
    // chặn hết (FK constraint chặn cascade-delete cả sản phẩm), xóa mềm tránh hẳn vấn đề
    // đó, record vẫn còn để giữ lịch sử đơn hàng/review. Gỡ khỏi mọi bộ sưu tập luôn
    // (CollectionProduct) — nếu không, sản phẩm đã xóa vẫn "dính" âm thầm trong bộ sưu tập
    // cũ mà không có màn nào cho admin thấy để gỡ (AssignProductsModal.tsx chỉ hiện sản
    // phẩm đang duyệt được, sản phẩm đã xóa không lọt vào danh sách chọn nên không bao giờ
    // bỏ tick được), lâu dần thành dữ liệu rác. Không đổi slug (khác Category/Collection):
    // slug sản phẩm ảnh hưởng URL public, không cần giải phóng để tái dùng.
    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { productId: id } }),
      this.prisma.product.update({
        where: { id },
        data: { isDelete: true },
      }),
    ]);
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
    if (!product || product.isDelete) {
      throw new NotFoundException('Không tìm thấy sản phẩm');
    }
    // Dedupe trước khi ghi — client gửi trùng id sẽ đụng @@unique([collectionId,
    // productId]) và ném P2002 thô nếu không lọc trước.
    const collectionIds = [...new Set(dto.collectionIds)];
    if (collectionIds.length > 0) {
      const endDateByCollectionId =
        await this.assertCollectionsExist(collectionIds);
      // Đây là endpoint "thay thế toàn bộ" — FE gửi lại nguyên collection ENDED đã gán từ
      // trước (client không có cách bỏ chọn vì UI ẩn hẳn collection ENDED khỏi danh sách
      // chọn) lẫn với collection mới muốn thêm trong cùng 1 payload. Chỉ chặn ENDED cho id
      // thực sự MỚI xuất hiện so với danh sách hiện có — giữ nguyên id cũ dù đã ENDED thì
      // vẫn cho qua, nếu không sản phẩm đã từng gán vào 1 collection ENDED sẽ không bao giờ
      // lưu lại được bước "Bộ sưu tập" nữa (kể cả khi chỉ muốn thêm 1 collection còn hạn).
      const currentCollectionIds = new Set(
        (
          await this.prisma.collectionProduct.findMany({
            where: { productId },
            select: { collectionId: true },
          })
        ).map((cp) => cp.collectionId),
      );
      const newlyAddedCollectionIds = diffNewlyAdded(
        collectionIds,
        currentCollectionIds,
      );
      this.assertNoEndedCollections(
        endDateByCollectionId,
        newlyAddedCollectionIds,
      );
      // Cùng lý do — chỉ chặn khi có collection MỚI thêm vào, giữ nguyên collection cũ đã
      // gán từ lúc sản phẩm còn ACTIVE dù sau đó chuyển DRAFT/INACTIVE.
      this.assertActiveIfAddingCollections(
        product.status,
        newlyAddedCollectionIds,
      );
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
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { endDate: true, isDelete: true },
    });
    if (!collection || collection.isDelete) {
      throw new NotFoundException('Không tìm thấy bộ sưu tập');
    }
    if (isCollectionEnded(collection.endDate)) {
      throw new BadRequestException(
        'Bộ sưu tập đã kết thúc — không thể gỡ sản phẩm khỏi bộ sưu tập đã kết thúc.',
      );
    }

    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { productId, collectionId },
    });
    if (count === 0) {
      throw new NotFoundException('Sản phẩm không thuộc bộ sưu tập này');
    }
  }

  private async syncVariants(
    tx: Db,
    productId: string,
    productSlug: string,
    basePrice: number,
    existingVariants: ProductVariant[],
    incoming: UpdateProductVariantDto[],
    userId: string,
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
        // Tồn kho biến thể ĐÃ CÓ không được sửa ở đây, kể cả khi client gửi kèm
        // stockQuantity — mọi thay đổi tồn kho phải đi qua InventoryService (nhập/xuất/
        // điều chỉnh) để luôn sinh 1 dòng StockMovement tương ứng. Sửa sản phẩm chỉ được
        // đổi thông tin mô tả biến thể (size/màu/SKU/giá/ảnh), không được ghi đè số tồn.
        await tx.productVariant.update({
          where: { id: item.id },
          data: {
            size: item.size,
            color: item.color,
            sku,
            price: item.price ?? basePrice,
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
        const created = await tx.productVariant.create({
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

        // Biến thể mới thêm giữa lúc sửa sản phẩm — cùng lý do với create(): tồn kho ban
        // đầu (nếu có) phải mở sổ ngay, không để lịch sử kho thiếu điểm bắt đầu.
        if (created.stockQuantity > 0) {
          await tx.stockMovement.create({
            data: {
              productVariantId: created.id,
              type: StockMovementType.IMPORT,
              quantity: created.stockQuantity,
              note: 'Tồn kho khởi tạo',
              createdById: userId,
            },
          });
        }
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
          // P2003 giờ có thể đến từ 2 ràng buộc: đã nằm trong giỏ hàng/đơn hàng, hoặc đã
          // có lịch sử nhập/xuất/điều chỉnh kho (StockMovement giờ Restrict, không còn
          // Cascade — xem schema.prisma) — không phân biệt cụ thể ràng buộc nào để tránh
          // phải truy vấn thêm, gộp chung 1 thông báo bao quát cả 2 trường hợp.
          throw new ConflictException(
            `Không thể xóa biến thể ${variant.sku} vì đã phát sinh giao dịch liên quan (đơn hàng/giỏ hàng hoặc lịch sử nhập/xuất kho).`,
          );
        }
        throw err;
      }
    }
  }

  // Trả về endDate theo id để gọi nơi cần check thêm "đã kết thúc" — tách riêng khỏi check
  // tồn tại vì assignCollections() chỉ cần chặn ENDED cho collection MỚI thêm vào, không
  // chặn collection ENDED đã gán từ trước còn giữ nguyên trong danh sách (xem
  // assignCollections()).
  private async assertCollectionsExist(
    collectionIds: string[],
  ): Promise<Map<string, Date>> {
    const uniqueIds = new Set(collectionIds);
    const collections = await this.prisma.collection.findMany({
      where: { id: { in: [...uniqueIds] }, isDelete: false },
      select: { id: true, endDate: true },
    });
    if (collections.length !== uniqueIds.size) {
      throw new BadRequestException(
        'Có bộ sưu tập không tồn tại trong danh sách gán',
      );
    }
    return new Map(collections.map((c) => [c.id, c.endDate]));
  }

  private assertNoEndedCollections(
    endDateByCollectionId: Map<string, Date>,
    collectionIdsToCheck: string[],
  ): void {
    const hasEnded = collectionIdsToCheck.some((id) =>
      isCollectionEnded(endDateByCollectionId.get(id)!),
    );
    if (hasEnded) {
      throw new ConflictException({
        message:
          'Có bộ sưu tập đã kết thúc trong danh sách gán — không thể gán sản phẩm vào bộ sưu tập đã kết thúc.',
        code: ErrorCode.PRODUCT_COLLECTION_ENDED,
      });
    }
  }

  // Chỉ sản phẩm ĐANG MỞ BÁN (ACTIVE) mới được gán vào bộ sưu tập — bộ sưu tập dùng để
  // quảng bá/trưng bày trên storefront, sản phẩm nháp (DRAFT)/ngừng kinh doanh (INACTIVE)
  // không có lý do xuất hiện trong đó. Chỉ chặn khi thực sự có collection MỚI thêm vào
  // (newlyAddedCollectionIds rỗng thì bỏ qua, khớp assertNoEndedCollections()).
  private assertActiveIfAddingCollections(
    productStatus: ProductStatus,
    newlyAddedCollectionIds: string[],
  ): void {
    if (
      newlyAddedCollectionIds.length > 0 &&
      productStatus !== ProductStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Chỉ có thể gán sản phẩm đang mở bán vào bộ sưu tập.',
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
    isDelete: product.isDelete,
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
