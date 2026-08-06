import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree(includeInactive: boolean): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
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

    const slug = await this.resolveUniqueSlug(dto.slug ?? dto.name);

    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId ?? null,
        image: dto.image,
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
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        image: dto.image,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.assertCategoryExists(id);

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
      if (item.parentId && !parentMap.has(item.parentId)) {
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

function buildTree(categories: Category[]): CategoryTreeNode[] {
  const nodeMap = new Map<string, CategoryTreeNode>();
  categories.forEach((c) => nodeMap.set(c.id, { ...c, children: [] }));

  const roots: CategoryTreeNode[] = [];
  for (const category of categories) {
    const node = nodeMap.get(category.id)!;
    if (category.parentId && nodeMap.has(category.parentId)) {
      nodeMap.get(category.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
