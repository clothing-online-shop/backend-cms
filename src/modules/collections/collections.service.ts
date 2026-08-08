import {
  BadRequestException,
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
    await this.findExisting(id);
    await this.prisma.collection.delete({ where: { id } });
  }

  // Thay thế TOÀN BỘ danh sách sản phẩm của bộ sưu tập — cùng cách tiếp cận với
  // assignCollections bên ProductsService (chiều ngược lại): FE luôn gửi danh sách đầy
  // đủ mong muốn, không phải diff thủ công.
  async assignProducts(
    collectionId: string,
    dto: AssignProductsDto,
  ): Promise<void> {
    await this.findExisting(collectionId);
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
    if (!collection) {
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

// So sánh theo ngày lịch (bỏ qua giờ) để BST kết thúc "hôm nay" vẫn coi là RUNNING
// tới hết ngày, thay vì rơi sang ENDED ngay từ 00:00.
function toDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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
