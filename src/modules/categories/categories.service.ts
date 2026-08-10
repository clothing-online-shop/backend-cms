import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { generateSlug } from '../../common/utils/slug.util';
import { ErrorCode } from '../../common/constants/error-codes';
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

  // includeDeleted CHỈ dùng nội bộ để FE tra tên danh mục cho sản phẩm cũ đã gán vào
  // danh mục đã xóa mềm (xem categories.controller.ts) — không dùng cho dropdown chọn
  // danh mục, mặc định false để tự loại danh mục đã xóa khỏi mọi nơi CHỌN.
  async findTree(
    includeInactive: boolean,
    includeDeleted = false,
  ): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(includeDeleted ? {} : { isDelete: false }),
      },
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

    if (!category || category.isDelete) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    if (dto.parentId) {
      await this.assertCategoryExists(dto.parentId);
    }
    await this.assertDepthWithinLimit(dto.parentId ?? null);
    await this.assertUniqueName(dto.name, dto.parentId ?? null);

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

    // Chỉ cần check lại tên trùng khi name hoặc parentId thực sự đổi — đổi cha mà giữ
    // nguyên tên vẫn phải check vì có thể trùng tên với anh em ở cha mới.
    if (dto.name !== undefined || dto.parentId !== undefined) {
      const nextName = dto.name ?? existing.name;
      const nextParentId =
        dto.parentId !== undefined ? dto.parentId : existing.parentId;
      await this.assertUniqueName(nextName, nextParentId, id);
    }

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
    await this.assertCategoryExists(id);

    // isDelete: false — sản phẩm đã xóa mềm không còn tính là "còn thuộc danh mục này"
    // nữa, không được chặn xóa danh mục chỉ vì còn sản phẩm đã xóa mềm bên trong.
    const [productCount, childrenCount] = await Promise.all([
      this.prisma.product.count({
        where: { categoryId: id, isDelete: false },
      }),
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

    // Xóa mềm — record vẫn còn để sản phẩm cũ đã gán vào danh mục này tra được tên
    // (xem findTree()/findBySlug() lọc isDelete). Không xóa ảnh Cloudinary vì record
    // chưa thật sự mất.
    await this.prisma.category.update({
      where: { id },
      data: { isDelete: true },
    });
  }

  async reorder(dto: ReorderCategoriesDto): Promise<void> {
    // isDelete: false — danh mục đã xóa mềm không còn tồn tại theo nghĩa nghiệp vụ, không
    // tham gia sắp xếp/validate cha-con nữa (đồng thời khiến item.id trỏ tới 1 danh mục đã
    // xóa tự động rơi vào nhánh NotFoundException bên dưới, nhất quán với assertCategoryExists()).
    const all = await this.prisma.category.findMany({
      where: { isDelete: false },
      select: { id: true, parentId: true, name: true },
    });
    const nameMap = new Map(all.map((c) => [c.id, c.name]));
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

    // Kéo-thả đổi cha qua reorder cũng phải tuân 2 quy tắc tên như create()/update() —
    // trước đây bị bỏ sót, chỉ check khi tạo/sửa trực tiếp, không check khi đổi cha bằng
    // kéo-thả. CHỈ check những danh mục ĐANG đổi cha trong batch này (giống đúng độ chi
    // tiết create()/update() đang làm — chỉ check món đang sửa) — không quét toàn bộ cây,
    // tránh chặn nhầm các lần sắp xếp không liên quan chỉ vì có sẵn data cũ lỡ trùng tên
    // từ trước khi có rule này (đã gặp thật lúc test, không phải phòng hờ lý thuyết).
    const movedIds = dto.items
      .filter((item) => item.parentId !== undefined)
      .map((item) => item.id);
    this.assertNoNameConflictsForMovedItems(movedIds, nameMap, parentMap);

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

  // Bản in-memory của 2 quy tắc ở assertUniqueName(), áp cho reorder() — chỉ check những
  // danh mục CÓ MẶT trong movedIds (đang đổi cha ở lần gọi này), không quét toàn bộ cây,
  // để không chặn nhầm thao tác sắp xếp không liên quan chỉ vì có data cũ lỡ trùng tên từ
  // trước khi có rule này.
  private assertNoNameConflictsForMovedItems(
    movedIds: string[],
    nameMap: Map<string, string>,
    parentMap: Map<string, string | null>,
  ): void {
    for (const id of movedIds) {
      const normalizedName = (nameMap.get(id) ?? '').trim().toLowerCase();
      const parentId = parentMap.get(id) ?? null;

      for (const [otherId, otherParentId] of parentMap) {
        if (otherId === id || otherParentId !== parentId) continue;
        if (
          (nameMap.get(otherId) ?? '').trim().toLowerCase() === normalizedName
        ) {
          throw new ConflictException({
            code: ErrorCode.CATEGORY_NAME_DUPLICATE,
            message: 'Thao tác sắp xếp làm 2 danh mục cùng cha bị trùng tên',
          });
        }
      }

      let cursor = parentId;
      const visited = new Set<string>([id]);
      while (cursor) {
        if (visited.has(cursor)) break; // vòng lặp cha-con đã có chỗ báo lỗi riêng bên dưới
        visited.add(cursor);
        if (
          (nameMap.get(cursor) ?? '').trim().toLowerCase() === normalizedName
        ) {
          throw new ConflictException({
            code: ErrorCode.CATEGORY_NAME_MATCHES_ANCESTOR,
            message:
              'Thao tác sắp xếp làm 1 danh mục trùng tên với tổ tiên của nó',
          });
        }
        cursor = parentMap.get(cursor) ?? null;
      }
    }
  }

  // 2 quy tắc: (1) không trùng tên với các danh mục CÙNG cha (anh em) — khác cha thì
  // trùng tên vẫn hợp lệ (vd "Áo" nằm dưới cả "Nam" và "Nữ"), không chặn trùng tên toàn
  // cây; (2) không trùng tên với BẤT KỲ tổ tiên nào của nó (cha, ông...) — không chỉ cha
  // trực tiếp, tránh case "A" > "B" > "A" lọt qua dù cây chỉ sâu tối đa
  // MAX_CATEGORY_DEPTH cấp nên case này hiếm gặp.
  private async assertUniqueName(
    name: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const trimmedName = name.trim();

    // isDelete: false — danh mục đã xóa mềm không còn tồn tại theo nghĩa nghiệp vụ, tên
    // của nó phải dùng lại được (không thì xóa xong vẫn không tạo lại được tên cũ).
    const duplicateSibling = await this.prisma.category.findFirst({
      where: {
        parentId,
        name: { equals: trimmedName, mode: 'insensitive' },
        isDelete: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (duplicateSibling) {
      throw new ConflictException({
        code: ErrorCode.CATEGORY_NAME_DUPLICATE,
        message: 'Đã tồn tại danh mục cùng tên trong cùng danh mục cha',
      });
    }

    if (parentId) {
      await this.assertNameNotUsedByAncestors(trimmedName, parentId);
    }
  }

  private async assertNameNotUsedByAncestors(
    name: string,
    parentId: string,
  ): Promise<void> {
    const normalizedName = name.toLowerCase();
    let cursor: string | null = parentId;
    const visited = new Set<string>();

    while (cursor) {
      if (visited.has(cursor)) break; // phòng hờ vòng lặp cha-con hỏng dữ liệu, tránh treo
      visited.add(cursor);

      const ancestor: { name: string; parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { name: true, parentId: true },
        });
      if (!ancestor) break;

      if (ancestor.name.trim().toLowerCase() === normalizedName) {
        throw new ConflictException({
          code: ErrorCode.CATEGORY_NAME_MATCHES_ANCESTOR,
          message:
            'Tên danh mục không được trùng với danh mục tổ tiên (cha, ông...) của nó',
        });
      }
      cursor = ancestor.parentId;
    }
  }

  private async assertCategoryExists(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || category.isDelete) {
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

  return roots;
}
