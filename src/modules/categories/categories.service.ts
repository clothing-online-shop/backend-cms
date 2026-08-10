import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { UploadService } from '../upload/upload.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

export interface CategoryTreeNode extends Category {
  productCount: number;
  children: CategoryTreeNode[];
}

// Shop thực tế chỉ cần 2-3 cấp (danh mục lớn > danh mục con > danh mục con con);
// chặn sâu hơn để tránh cây danh mục phình to khó quản lý ở màn admin.
const MAX_CATEGORY_DEPTH = 3;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async findTree(includeInactive: boolean): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return buildTree(categories);
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        parent: true,
        children: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!category) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    if (dto.parentId) {
      await this.assertCategoryExists(dto.parentId);
    }
    await this.assertDepthWithinLimit(dto.parentId ?? null);

    const slug = await this.resolveUniqueSlug(dto.slug ?? dto.name);

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId ?? null,
        image: dto.image ?? null,
        imagePublicId: dto.imagePublicId ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const existing = await this.assertCategoryExists(id);

    let slug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      slug = await this.resolveUniqueSlug(dto.slug, id);
    }

    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Danh mục không thể là cha của chính nó');
      }
      if (dto.parentId) {
        await this.assertCategoryExists(dto.parentId);
        await this.assertNoCycle(id, dto.parentId);
      }
      await this.assertDepthWithinLimit(dto.parentId ?? null, id);
    }

    const imageChanged =
      dto.image !== undefined && dto.image !== existing.image;

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        image: dto.image === undefined ? undefined : dto.image,
        imagePublicId:
          dto.imagePublicId === undefined ? undefined : dto.imagePublicId,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });

    // Best-effort, chạy SAU khi update DB đã thành công — dọn trước mà update sau đó
    // lỗi (constraint, mất kết nối DB...) thì ảnh cũ đã bị xoá vĩnh viễn trên Cloudinary
    // trong khi DB vẫn còn trỏ tới URL đã chết. Lỗi xóa ảnh cũ ở đây không được chặn
    // response thành công — ảnh mồ côi còn hơn admin tưởng lưu thất bại.
    if (imageChanged && existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.assertCategoryExists(id);

    const [productCount, childrenCount] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);

    if (productCount > 0) {
      throw new ConflictException(
        `Không thể xóa danh mục vì còn ${productCount} sản phẩm thuộc danh mục này`,
      );
    }
    if (childrenCount > 0) {
      throw new ConflictException(
        'Không thể xóa danh mục vì còn danh mục con bên trong',
      );
    }

    await this.prisma.category.delete({ where: { id } });

    if (existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }
  }

  async reorder(dto: ReorderCategoriesDto): Promise<void> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const parentMap = new Map(all.map((c) => [c.id, c.parentId]));

    for (const item of dto.items) {
      if (!parentMap.has(item.id)) {
        throw new NotFoundException(`Không tìm thấy danh mục ${item.id}`);
      }
      if (
        item.parentId !== undefined &&
        item.parentId !== null &&
        !parentMap.has(item.parentId)
      ) {
        throw new NotFoundException(
          `Không tìm thấy danh mục cha ${item.parentId}`,
        );
      }
      if (item.parentId !== undefined) {
        parentMap.set(item.id, item.parentId);
      }
    }

    for (const id of parentMap.keys()) {
      let cursor = parentMap.get(id) ?? null;
      const visited = new Set<string>([id]);
      while (cursor) {
        if (visited.has(cursor)) {
          throw new BadRequestException(
            'Thao tác sắp xếp tạo ra vòng lặp cha-con không hợp lệ',
          );
        }
        visited.add(cursor);
        cursor = parentMap.get(cursor) ?? null;
      }
      // visited.size = số cấp từ gốc tới id (gồm chính nó) sau khi áp các thay đổi ở trên.
      if (visited.size > MAX_CATEGORY_DEPTH) {
        throw new BadRequestException(
          `Cây danh mục chỉ được sâu tối đa ${MAX_CATEGORY_DEPTH} cấp`,
        );
      }
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.category.update({
          where: { id: item.id },
          data: {
            sortOrder: item.sortOrder,
            parentId: item.parentId === undefined ? undefined : item.parentId,
          },
        }),
      ),
    );
  }

  private async assertCategoryExists(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }
    return category;
  }

  private async assertNoCycle(
    categoryId: string,
    newParentId: string,
  ): Promise<void> {
    let cursor: string | null = newParentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === categoryId) {
        throw new BadRequestException(
          'Không thể đặt danh mục con làm cha của chính tổ tiên của nó',
        );
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const parent: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }

  private async assertDepthWithinLimit(
    parentId: string | null,
    movingId?: string,
  ): Promise<void> {
    const depth = await this.computeDepth(parentId);
    const subtreeHeight = movingId
      ? await this.computeSubtreeHeight(movingId)
      : 0;

    if (depth + subtreeHeight > MAX_CATEGORY_DEPTH) {
      throw new BadRequestException(
        `Cây danh mục chỉ được sâu tối đa ${MAX_CATEGORY_DEPTH} cấp`,
      );
    }
  }

  private async computeDepth(parentId: string | null): Promise<number> {
    let depth = 1;
    let cursor = parentId;
    while (cursor) {
      depth += 1;
      const parent: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
    return depth;
  }

  // Chiều cao cây con hiện có bên dưới `id` — cần cộng vào depth mới khi dời cả
  // 1 nhánh sang chỗ khác, tránh trường hợp bản thân node hợp lệ nhưng con/cháu
  // của nó lại vượt quá MAX_CATEGORY_DEPTH.
  private async computeSubtreeHeight(id: string): Promise<number> {
    const children = await this.prisma.category.findMany({
      where: { parentId: id },
      select: { id: true },
    });
    if (children.length === 0) return 0;

    const heights = await Promise.all(
      children.map((child) => this.computeSubtreeHeight(child.id)),
    );
    return 1 + Math.max(...heights);
  }

  private async resolveUniqueSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = generateSlug(source);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.category.findFirst({
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

function buildTree(
  categories: (Category & { _count: { products: number } })[],
): CategoryTreeNode[] {
  const nodeMap = new Map<string, CategoryTreeNode>();
  categories.forEach((c) => {
    const { _count, ...rest } = c;
    nodeMap.set(c.id, { ...rest, productCount: _count.products, children: [] });
  });

  const roots: CategoryTreeNode[] = [];
  for (const category of categories) {
    const node = nodeMap.get(category.id)!;
    if (category.parentId && nodeMap.has(category.parentId)) {
      nodeMap.get(category.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // productCount hiển thị ở màn quản lý cây danh mục cần cộng dồn cả danh mục con (danh
  // mục cha là nhóm gộp, admin kỳ vọng thấy tổng số sản phẩm thuộc nhóm đó) — cộng dồn từ
  // lá lên gốc, không ảnh hưởng tới productCount dùng để chặn xóa ở remove() (query riêng,
  // vẫn đếm trực tiếp theo categoryId, đúng ý nghĩa "danh mục NÀY còn sản phẩm hay không").
  addDescendantProductCounts(roots);

  return roots;
}

function addDescendantProductCounts(nodes: CategoryTreeNode[]): void {
  for (const node of nodes) {
    addDescendantProductCounts(node.children);
    node.productCount += node.children.reduce(
      (sum, child) => sum + child.productCount,
      0,
    );
  }
}
