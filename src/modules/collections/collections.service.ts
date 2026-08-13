import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ListCollectionsQueryDto } from './dto/list-collections-query.dto';
import { AssignProductsDto } from './dto/assign-products.dto';
import { CollectionStatus } from './collection-status.enum';
import { ErrorCode } from '../../common/constants/error-codes';
import { toDateOnly, isCollectionEnded } from './collection-status.util';
import { ProductStatus } from '../products/product-status.enum';
import { diffNewlyAdded } from '../../common/utils/diff.util';

export type CollectionWithStatus = Collection & {
  status: CollectionStatus;
  products: {
    id: string;
    name: string;
    slug: string;
    thumbnail: string | null;
  }[];
};

// id/name/slug/thumbnail — đủ cho badge lẫn ảnh preview hiển thị (khớp shape
// ProductListItem.collections bên products.service.ts, chiều ngược lại), không kéo cả
// object Product đầy đủ. Lọc product.isDelete: false phòng dữ liệu cũ từ trước khi
// Product.remove() tự gỡ CollectionProduct (xem products.service.ts remove()) — không lọc
// thì 1 sản phẩm đã xóa mềm từ lâu, lỡ còn sót bản ghi nối cũ, vẫn hiện tên như đang thuộc
// bộ sưu tập.
const PRODUCTS_INCLUDE = {
  products: {
    where: { product: { isDelete: false } },
    include: {
      product: {
        select: { id: true, name: true, slug: true, thumbnail: true },
      },
    },
  },
} satisfies Prisma.CollectionInclude;

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListCollectionsQueryDto,
  ): Promise<CollectionWithStatus[]> {
    const where: Prisma.CollectionWhereInput = {};
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.includeDeleted !== 'true') {
      where.isDelete = false;
    }

    const collections = await this.prisma.collection.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: PRODUCTS_INCLUDE,
    });
    const withStatuses = collections.map(withStatus);
    // status là field tính động (không nằm trong DB) nên lọc ENDED ở đây, sau khi đã
    // map, thay vì đưa vào Prisma `where` phía trên.
    return query.excludeEnded === 'true'
      ? withStatuses.filter((c) => c.status !== CollectionStatus.ENDED)
      : withStatuses;
  }

  async findOne(id: string): Promise<CollectionWithStatus> {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: PRODUCTS_INCLUDE,
    });
    if (!collection || collection.isDelete) {
      throw new NotFoundException('Không tìm thấy bộ sưu tập');
    }
    return withStatus(collection);
  }

  async create(dto: CreateCollectionDto): Promise<CollectionWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(dto.startDate);
    const slug = await this.resolveUniqueSlug(dto.name);

    const collection = await this.prisma.collection.create({
      data: {
        name: dto.name,
        slug,
        banner: dto.banner,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
      include: PRODUCTS_INCLUDE,
    });
    return withStatus(collection);
  }

  async update(
    id: string,
    dto: UpdateCollectionDto,
  ): Promise<CollectionWithStatus> {
    const existing = await this.findExisting(id);
    const { status } = withStatus(existing);

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

    const nameChanged = dto.name !== undefined && dto.name !== existing.name;
    const startDateChanged =
      dto.startDate !== undefined &&
      new Date(dto.startDate).getTime() !== existing.startDate.getTime();
    const endDateChanged =
      dto.endDate !== undefined &&
      new Date(dto.endDate).getTime() !== existing.endDate.getTime();
    const bannerChanged =
      dto.banner !== undefined && dto.banner !== existing.banner;
    const descriptionChanged =
      dto.description !== undefined && dto.description !== existing.description;

    if (
      status === CollectionStatus.RUNNING &&
      (nameChanged || startDateChanged)
    ) {
      throw new ConflictException({
        message:
          'Bộ sưu tập đang diễn ra — không thể đổi tên hoặc ngày bắt đầu, chỉ được sửa banner/mô tả/ngày kết thúc.',
        code: ErrorCode.COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING,
      });
    }

    if (
      status === CollectionStatus.ENDED &&
      (nameChanged ||
        startDateChanged ||
        endDateChanged ||
        bannerChanged ||
        descriptionChanged)
    ) {
      throw new ConflictException({
        message: 'Bộ sưu tập đã kết thúc — không thể chỉnh sửa.',
        code: ErrorCode.COLLECTION_UPDATE_BLOCKED_ENDED,
      });
    }

    if (status === CollectionStatus.UPCOMING && startDateChanged) {
      assertStartDateNotInPast(dto.startDate!);
    }

    let slug = existing.slug;
    if (dto.name && dto.name !== existing.name) {
      slug = await this.resolveUniqueSlug(dto.name, id);
    }

    const updated = await this.prisma.collection.update({
      where: { id },
      data: {
        name: dto.name,
        slug,
        banner: dto.banner === undefined ? undefined : dto.banner,
        description:
          dto.description === undefined ? undefined : dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
      include: PRODUCTS_INCLUDE,
    });
    return withStatus(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    if (withStatus(existing).status === CollectionStatus.RUNNING) {
      throw new ConflictException({
        message:
          'Không thể xóa bộ sưu tập đang diễn ra — đợi kết thúc hoặc sửa lại ngày kết thúc trước khi xóa.',
        code: ErrorCode.COLLECTION_DELETE_BLOCKED_RUNNING,
      });
    }
    // slug có @unique cứng ở tầng DB, không biết gì về isDelete — nếu giữ nguyên slug cũ,
    // lần tạo/sửa sau tái sử dụng đúng slug đó sẽ đụng unique constraint. Đổi slug sang giá
    // trị chắc chắn không đụng hàng (kèm id) để giải phóng slug gốc, cùng cách đã làm cho
    // Category (xem categories.service.ts remove()). Xóa mềm không tự cascade gỡ
    // CollectionProduct (cascade của Prisma chỉ chạy khi DELETE thật, không chạy khi chỉ
    // update cờ isDelete) — phải chủ động deleteMany để sản phẩm không còn hiển thị "đang
    // thuộc" 1 bộ sưu tập đã xóa.
    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { collectionId: id } }),
      this.prisma.collection.update({
        where: { id },
        data: { isDelete: true, slug: `${existing.slug}-deleted-${id}` },
      }),
    ]);
  }

  // Thay thế TOÀN BỘ danh sách sản phẩm của bộ sưu tập — cùng cách tiếp cận với
  // assignCollections bên ProductsService (chiều ngược lại): FE luôn gửi danh sách đầy
  // đủ mong muốn, không phải diff thủ công.
  async assignProducts(
    collectionId: string,
    dto: AssignProductsDto,
  ): Promise<void> {
    const collection = await this.findExisting(collectionId);
    if (withStatus(collection).status === CollectionStatus.ENDED) {
      throw new ConflictException({
        message: 'Bộ sưu tập đã kết thúc — không thể gán/gỡ sản phẩm.',
        code: ErrorCode.COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED,
      });
    }
    // Dedupe trước khi ghi — client gửi trùng id sẽ đụng @@unique([collectionId,
    // productId]) và ném P2002 thô nếu không lọc trước.
    const productIds = [...new Set(dto.productIds)];
    if (productIds.length > 0) {
      // Chỉ chặn sản phẩm chưa mở bán/ngừng kinh doanh cho id MỚI thêm vào — sản phẩm đã
      // gán từ trước mà sau đó đổi trạng thái (vd tạm ngừng bán) vẫn giữ nguyên khi FE gửi
      // lại nguyên set cũ, khớp cách assertNoEndedCollections() xử lý ENDED (xem
      // products.service.ts assignCollections(), chiều ngược lại). 2 query độc lập nhau
      // (sản phẩm nào tồn tại/status gì vs. collection này đang chứa sản phẩm nào) — chạy
      // song song thay vì nối tiếp để đỡ 1 round-trip DB.
      const [statusByProductId, currentProducts] = await Promise.all([
        this.assertProductsExist(productIds),
        this.prisma.collectionProduct.findMany({
          where: { collectionId },
          select: { productId: true },
        }),
      ]);
      const currentProductIds = new Set(
        currentProducts.map((cp) => cp.productId),
      );
      const newlyAddedProductIds = diffNewlyAdded(
        productIds,
        currentProductIds,
      );
      this.assertOnlyActiveProducts(statusByProductId, newlyAddedProductIds);
    }

    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { collectionId } }),
      this.prisma.collectionProduct.createMany({
        data: productIds.map((productId) => ({ collectionId, productId })),
      }),
    ]);
  }

  async removeProduct(collectionId: string, productId: string): Promise<void> {
    const collection = await this.findExisting(collectionId);
    if (withStatus(collection).status === CollectionStatus.ENDED) {
      throw new ConflictException({
        message: 'Bộ sưu tập đã kết thúc — không thể gán/gỡ sản phẩm.',
        code: ErrorCode.COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED,
      });
    }

    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { collectionId, productId },
    });
    if (count === 0) {
      throw new NotFoundException('Bộ sưu tập không chứa sản phẩm này');
    }
  }

  // Trả về status theo id để assignProducts() check thêm "đang mở bán" — tách riêng khỏi
  // check tồn tại vì chỉ cần chặn ACTIVE cho sản phẩm MỚI thêm vào (xem assignProducts()).
  private async assertProductsExist(
    productIds: string[],
  ): Promise<Map<string, ProductStatus>> {
    const uniqueIds = new Set(productIds);
    // isDelete: false — sản phẩm đã xóa mềm coi như không tồn tại, không cho gán (lại)
    // vào bộ sưu tập (khớp assertCategoryExists() ở categories.service.ts). Từ khi
    // Product.remove() tự gỡ khỏi mọi CollectionProduct, kịch bản "gán lại đúng sản phẩm
    // đã xóa vì FE gửi lại nguyên set cũ" không còn xảy ra nữa, nên siết luôn ở đây an toàn.
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...uniqueIds] }, isDelete: false },
      select: { id: true, status: true },
    });
    if (products.length !== uniqueIds.size) {
      throw new BadRequestException(
        'Có sản phẩm không tồn tại trong danh sách gán',
      );
    }
    return new Map(products.map((p) => [p.id, p.status]));
  }

  // Chỉ cho gán sản phẩm ĐANG MỞ BÁN (ACTIVE) vào bộ sưu tập — bộ sưu tập dùng để quảng bá/
  // trưng bày trên storefront, sản phẩm nháp (DRAFT)/ngừng kinh doanh (INACTIVE) không có
  // lý do xuất hiện trong đó.
  private assertOnlyActiveProducts(
    statusByProductId: Map<string, ProductStatus>,
    productIdsToCheck: string[],
  ): void {
    const hasInactive = productIdsToCheck.some(
      (id) => statusByProductId.get(id) !== ProductStatus.ACTIVE,
    );
    if (hasInactive) {
      throw new BadRequestException(
        'Chỉ có thể gán sản phẩm đang mở bán vào bộ sưu tập.',
      );
    }
  }

  private async findExisting(id: string): Promise<Collection> {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
    });
    if (!collection || collection.isDelete) {
      throw new NotFoundException('Không tìm thấy bộ sưu tập');
    }
    return collection;
  }

  private async resolveUniqueSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = generateSlug(source);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.collection.findFirst({
        where: {
          slug: candidate,
          isDelete: false,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}

function assertDateRange(startDate: string, endDate: string): void {
  if (new Date(endDate) < new Date(startDate)) {
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }
}

function assertStartDateNotInPast(startDate: string): void {
  if (toDateOnly(new Date(startDate)) < toDateOnly(new Date())) {
    throw new ConflictException({
      message: 'Ngày bắt đầu không được ở trong quá khứ.',
      code: ErrorCode.COLLECTION_START_DATE_IN_PAST,
    });
  }
}

// So sánh theo ngày lịch (bỏ qua giờ) để BST kết thúc "hôm nay" vẫn coi là RUNNING
// tới hết ngày, thay vì rơi sang ENDED ngay từ 00:00. `products` optional — 1 vài nơi gọi
// hàm này chỉ cần lấy `.status` từ 1 bản ghi Collection trần (không include products, xem
// update()), mặc định [] cho những chỗ đó.
function withStatus(
  collection: Collection & {
    products?: {
      product: {
        id: string;
        name: string;
        slug: string;
        thumbnail: string | null;
      };
    }[];
  },
): CollectionWithStatus {
  const today = toDateOnly(new Date());
  const start = toDateOnly(collection.startDate);

  let status: CollectionStatus;
  if (today < start) {
    status = CollectionStatus.UPCOMING;
  } else if (isCollectionEnded(collection.endDate)) {
    status = CollectionStatus.ENDED;
  } else {
    status = CollectionStatus.RUNNING;
  }

  return {
    ...collection,
    status,
    products: (collection.products ?? []).map((cp) => cp.product),
  };
}
