import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Collection, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { toDateOnly } from '../../common/utils/date.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ListCollectionsQueryDto } from './dto/list-collections-query.dto';
import { AssignProductsDto } from './dto/assign-products.dto';
import { CollectionStatus } from './collection-status.enum';

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
    // Không truyền includeDeleted → mặc định isDelete: false (giống categories).
    if (query.includeDeleted !== 'true') {
      where.isDelete = false;
    }
    // excludeEnded: loại ENDED (endDate < hôm nay) — chỉ còn UPCOMING + RUNNING. So theo
    // ngày (bỏ giờ) khớp đúng cách withStatus() bên dưới tính status, để 2 nơi không lệch
    // nhau ở biên "endDate là hôm nay" (vẫn RUNNING, không bị loại).
    if (query.excludeEnded === 'true') {
      where.endDate = { gte: new Date(toDateOnly(new Date())) };
    }

    const collections = await this.prisma.collection.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });
    return collections.map(withStatus);
  }

  async findOne(id: string): Promise<CollectionWithStatus> {
    const collection = await this.findExisting(id);
    return withStatus(collection);
  }

  async create(dto: CreateCollectionDto): Promise<CollectionWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    // Chỉ chặn ở create() — update() không chặn vì bộ sưu tập cũ đã RUNNING/ENDED có
    // startDate quá khứ hợp lệ theo đúng bản chất, sửa các field khác (tên, banner...)
    // không nên bị chặn chỉ vì payload gửi kèm nguyên startDate cũ đó.
    if (toDateOnly(new Date(dto.startDate)) < toDateOnly(new Date())) {
      throw new BadRequestException({
        code: ErrorCode.COLLECTION_START_DATE_IN_PAST,
        message: 'Ngày bắt đầu không được ở trong quá khứ',
      });
    }
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
    const currentStatus = withStatus(existing).status;

    // Đã ENDED: không cho sửa gì nữa (khác RUNNING chỉ chặn 2 field) — chiến dịch đã kết
    // thúc, không còn lý do hợp lệ nào để đổi nội dung nó từng hiển thị.
    if (currentStatus === CollectionStatus.ENDED) {
      throw new ConflictException({
        code: ErrorCode.COLLECTION_UPDATE_BLOCKED_ENDED,
        message: 'Bộ sưu tập đã kết thúc — không thể chỉnh sửa',
      });
    }

    // Đang RUNNING: đổi tên kéo theo đổi slug (URL đang chia sẻ/index thật trên web bị
    // gãy), đổi ngày bắt đầu thì vô nghĩa vì đã diễn ra rồi — chỉ chặn 2 field này, vẫn
    // cho sửa banner/mô tả/ngày kết thúc (kéo dài/rút ngắn chiến dịch là nhu cầu thật).
    // So sánh != giá trị hiện có (không phải != undefined) — payload từ form luôn gửi kèm
    // name/startDate dù không đổi, nếu chặn theo "có mặt trong payload" sẽ chặn nhầm cả
    // lúc chỉ sửa banner/mô tả/ngày kết thúc.
    const nameChanged = dto.name !== undefined && dto.name !== existing.name;
    const startDateChanged =
      dto.startDate !== undefined &&
      toDateOnly(new Date(dto.startDate)) !== toDateOnly(existing.startDate);
    if (
      currentStatus === CollectionStatus.RUNNING &&
      (nameChanged || startDateChanged)
    ) {
      throw new ConflictException({
        code: ErrorCode.COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING,
        message:
          'Bộ sưu tập đang diễn ra — không thể đổi tên hoặc ngày bắt đầu, chỉ được sửa banner/mô tả/ngày kết thúc',
      });
    }

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);

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
    // withStatus tính RUNNING/UPCOMING/ENDED từ startDate/endDate (không lưu cột status
    // riêng) — chặn xóa khi đang RUNNING, tránh sản phẩm/banner đang hiển thị trên web
    // biến mất đột ngột giữa chiến dịch đang chạy.
    if (withStatus(existing).status === CollectionStatus.RUNNING) {
      throw new ConflictException({
        code: ErrorCode.COLLECTION_DELETE_BLOCKED_RUNNING,
        message:
          'Không thể xóa bộ sưu tập đang diễn ra — đợi kết thúc hoặc sửa lại ngày kết thúc trước khi xóa',
      });
    }
    // Xóa mềm — record vẫn còn để sản phẩm đã từng gán vào nó (kể cả CollectionProduct
    // join) giữ nguyên lịch sử, chỉ biến mất khỏi danh sách/nơi chọn (xem findAll()).
    await this.prisma.collection.update({
      where: { id },
      data: { isDelete: true },
    });
  }

  // Thay thế TOÀN BỘ danh sách sản phẩm của bộ sưu tập — cùng cách tiếp cận với
  // assignCollections bên ProductsService (chiều ngược lại): FE luôn gửi danh sách đầy
  // đủ mong muốn, không phải diff thủ công.
  async assignProducts(
    collectionId: string,
    dto: AssignProductsDto,
  ): Promise<void> {
    const existing = await this.findExisting(collectionId);
    this.assertNotEnded(existing);
    // Dedupe trước khi ghi — client gửi trùng id sẽ đụng @@unique([collectionId,
    // productId]) và ném P2002 thô nếu không lọc trước.
    const productIds = [...new Set(dto.productIds)];

    // Chỉ check "tồn tại & chưa xóa" cho sản phẩm MỚI thêm vào — sản phẩm đã thuộc bộ
    // sưu tập này từ trước (kể cả đã bị xóa mềm sau đó) vẫn được giữ nguyên khi ghi đè
    // lại toàn bộ danh sách, không bị chặn nhầm chỉ vì FE luôn gửi lại nguyên set cũ
    // (khớp cách assignCollections() bên ProductsService xử lý chiều ngược lại).
    const currentProductIds = new Set(
      (
        await this.prisma.collectionProduct.findMany({
          where: { collectionId },
          select: { productId: true },
        })
      ).map((cp) => cp.productId),
    );
    const newlyAddedIds = productIds.filter((id) => !currentProductIds.has(id));
    if (newlyAddedIds.length > 0) {
      await this.assertProductsExist(newlyAddedIds);
    }

    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { collectionId } }),
      this.prisma.collectionProduct.createMany({
        data: productIds.map((productId) => ({ collectionId, productId })),
      }),
    ]);
  }

  async removeProduct(collectionId: string, productId: string): Promise<void> {
    const existing = await this.findExisting(collectionId);
    this.assertNotEnded(existing);

    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { collectionId, productId },
    });
    if (count === 0) {
      throw new NotFoundException('Bộ sưu tập không chứa sản phẩm này');
    }
  }

  // Đã kết thúc thì không cho gán/gỡ sản phẩm nữa — chiến dịch đã xong, danh sách sản
  // phẩm của nó nên giữ nguyên làm lịch sử, không sửa được nữa (dùng chung cho cả
  // assignProducts và removeProduct — 2 API duy nhất ghi vào collection_products).
  private assertNotEnded(collection: Collection): void {
    if (withStatus(collection).status === CollectionStatus.ENDED) {
      throw new ConflictException({
        code: ErrorCode.COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED,
        message: 'Bộ sưu tập đã kết thúc — không thể gán/gỡ sản phẩm',
      });
    }
  }

  private async assertProductsExist(productIds: string[]): Promise<void> {
    const uniqueIds = new Set(productIds);
    // isDelete: false — sản phẩm đã xóa mềm coi như không tồn tại, không cho gán mới vào
    // bộ sưu tập (khớp assertCategoryExists() ở categories.service.ts / assertCollectionsNotEnded
    // ở products.service.ts — không cho gán qua bất kỳ chiều nào tới thứ đã "xóa").
    const count = await this.prisma.product.count({
      where: { id: { in: [...uniqueIds] }, isDelete: false },
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
    // Đã xóa mềm coi như không tồn tại — không cho xem/sửa/gán thêm vào 1 bộ sưu tập đã
    // xóa (khớp assertCategoryExists() ở categories.service.ts).
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

function withStatus(collection: Collection): CollectionWithStatus {
  const today = toDateOnly(new Date());
  const start = toDateOnly(collection.startDate);
  const end = toDateOnly(collection.endDate);

  let status: CollectionStatus;
  if (today < start) {
    status = CollectionStatus.UPCOMING;
  } else if (today > end) {
    status = CollectionStatus.ENDED;
  } else {
    status = CollectionStatus.RUNNING;
  }

  return { ...collection, status };
}
