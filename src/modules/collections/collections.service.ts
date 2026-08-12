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

export type CollectionWithStatus = Collection & { status: CollectionStatus };

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
    });
    const withStatuses = collections.map(withStatus);
    // status là field tính động (không nằm trong DB) nên lọc ENDED ở đây, sau khi đã
    // map, thay vì đưa vào Prisma `where` phía trên.
    return query.excludeEnded === 'true'
      ? withStatuses.filter((c) => c.status !== CollectionStatus.ENDED)
      : withStatuses;
  }

  async findOne(id: string): Promise<CollectionWithStatus> {
    const collection = await this.findExisting(id);
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
      await this.assertProductsExist(productIds);
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

  private async assertProductsExist(productIds: string[]): Promise<void> {
    const uniqueIds = new Set(productIds);
    const count = await this.prisma.product.count({
      where: { id: { in: [...uniqueIds] } },
    });
    if (count !== uniqueIds.size) {
      throw new BadRequestException(
        'Có sản phẩm không tồn tại trong danh sách gán',
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
// tới hết ngày, thay vì rơi sang ENDED ngay từ 00:00.
function withStatus(collection: Collection): CollectionWithStatus {
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

  return { ...collection, status };
}
