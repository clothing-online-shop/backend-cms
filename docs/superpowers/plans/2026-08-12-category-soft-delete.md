# Category Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi xóa danh mục từ xóa cứng sang xóa mềm bằng field `isDelete`; API lấy cây danh mục mặc định chỉ trả `isDelete: false`, truyền `includeDeleted` thì trả cả hai.

**Architecture:** Thêm `isDelete Boolean @default(false)` vào model `Category` (migration). `CategoriesService.remove()` đổi `delete()` thành `update({ isDelete: true })`. Mọi truy vấn liên quan tới "danh mục có tồn tại/hợp lệ để dùng" (`assertCategoryExists`, `reorder()`, `assertNoDuplicateSiblingName`, `resolveUniqueSlug`, `computeSubtreeHeight`) được lọc thêm `isDelete: false` để coi danh mục đã xóa mềm như vô hình — trừ `findTree()` khi có `includeDeleted=true`. Phía FE chỉ có 2 thay đổi kiểu dữ liệu/gọi API, không đổi UI.

**Tech Stack:** NestJS + Prisma (`backend-cms`), React + TypeScript (`frontend-admin`). Không thêm thư viện mới.

## Global Constraints

- Danh mục đã `isDelete: true` không thể được sửa, không thể được chọn làm cha, không thể bị xóa lần 2 (tất cả trả 404) — chưa có API khôi phục trong lần này.
- Check trùng tên (`assertNoDuplicateSiblingName`) và slug unique (`resolveUniqueSlug`) bỏ qua danh mục `isDelete: true` — tên/slug đã xóa mềm dùng lại được.
- Xóa mềm 1 danh mục vẫn bị chặn nếu còn sản phẩm hoặc còn **danh mục con chưa xóa mềm** — không cascade.
- Danh mục con đã xóa mềm không tính vào giới hạn độ sâu cây (`computeSubtreeHeight`).
- Categories không nằm trong danh sách module bắt buộc automated test (`CLAUDE.md` backend-cms chỉ bắt buộc Auth/Orders/Payments) — mỗi task xác nhận bằng lint + build, cộng 1 task verify thủ công bằng curl (BE) và trình duyệt (FE) ở cuối.

---

## Task 1: Backend — thêm field `isDelete` vào schema + migration

**Files:**
- Modify: `backend-cms/prisma/schema.prisma`

**Interfaces:**
- Produces: `Category.isDelete: boolean` (Prisma Client tự sinh lại sau migrate) — dùng ở Task 2.

- [ ] **Step 1: Thêm field vào model Category**

Trong `backend-cms/prisma/schema.prisma`, tìm model `Category`:

```prisma
model Category {
  id            String     @id @default(cuid())
  name          String
  slug          String     @unique
  image         String?
  imagePublicId String?
  isActive      Boolean    @default(true)
  sortOrder     Int        @default(0)
  parentId      String?
  parent        Category?  @relation("CategoryToCategory", fields: [parentId], references: [id])
  children      Category[] @relation("CategoryToCategory")
  products      Product[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  @@index([parentId])
  @@map("categories")
}
```

Thêm dòng `isDelete Boolean @default(false)` ngay sau `isActive`:

```prisma
model Category {
  id            String     @id @default(cuid())
  name          String
  slug          String     @unique
  image         String?
  imagePublicId String?
  isActive      Boolean    @default(true)
  isDelete      Boolean    @default(false)
  sortOrder     Int        @default(0)
  parentId      String?
  parent        Category?  @relation("CategoryToCategory", fields: [parentId], references: [id])
  children      Category[] @relation("CategoryToCategory")
  products      Product[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  @@index([parentId])
  @@map("categories")
}
```

- [ ] **Step 2: Chạy migration**

Đảm bảo dev server (`start:dev`) đang tắt trước khi chạy (Windows khóa file `query_engine-windows.dll.node` — xem `CLAUDE.md`).

Run: `pnpm --filter @clothing-shop/be prisma:migrate` → khi được hỏi tên migration, dùng `add_category_is_delete`.

Expected: migration mới xuất hiện trong `prisma/migrations/`, lệnh chạy xong không lỗi, Prisma Client được generate lại (type `Category` giờ có field `isDelete: boolean`).

- [ ] **Step 3: Build**

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(categories): add isDelete field for soft delete"
```

---

## Task 2: Backend — `remove()` xóa mềm thay vì xóa cứng

**Files:**
- Modify: `backend-cms/src/modules/categories/categories.service.ts`

**Interfaces:**
- Consumes: `Category.isDelete` (Task 1).

- [ ] **Step 1: Sửa `remove()`**

Thay toàn bộ method `remove()` hiện tại:

```ts
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
```

bằng:

```ts
  async remove(id: string): Promise<void> {
    const existing = await this.assertCategoryExists(id);

    const [productCount, childrenCount] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id, isDelete: false } }),
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

    await this.prisma.category.update({
      where: { id },
      data: { isDelete: true },
    });

    if (existing.imagePublicId) {
      await this.uploadService
        .deleteImage(existing.imagePublicId)
        .catch(() => undefined);
    }
  }
```

(Thay đổi: `childrenCount` thêm `isDelete: false`; `prisma.category.delete()` → `prisma.category.update({ data: { isDelete: true } })`. Phần dọn ảnh Cloudinary giữ nguyên.)

- [ ] **Step 2: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 3: Commit**

```bash
git add src/modules/categories/categories.service.ts
git commit -m "feat(categories): soft-delete instead of hard-delete on remove"
```

---

## Task 3: Backend — `assertCategoryExists` và các hàm liên quan coi danh mục đã xóa mềm là vô hình

**Files:**
- Modify: `backend-cms/src/modules/categories/categories.service.ts`

**Interfaces:**
- Consumes: `Category.isDelete` (Task 1).

- [ ] **Step 1: Sửa `assertCategoryExists`**

Thay:

```ts
  private async assertCategoryExists(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }
    return category;
  }
```

bằng:

```ts
  private async assertCategoryExists(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || category.isDelete) {
      throw new NotFoundException('Không tìm thấy danh mục');
    }
    return category;
  }
```

- [ ] **Step 2: Sửa `findBySlug`**

Thay:

```ts
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
```

bằng:

```ts
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
```

- [ ] **Step 3: Sửa `assertNoDuplicateSiblingName` — bỏ qua danh mục đã xóa mềm**

Thay:

```ts
  private async assertNoDuplicateSiblingName(
    name: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.prisma.category.findMany({
      where: {
        parentId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { name: true },
    });
```

bằng:

```ts
  private async assertNoDuplicateSiblingName(
    name: string,
    parentId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.prisma.category.findMany({
      where: {
        parentId,
        isDelete: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { name: true },
    });
```

(Phần thân còn lại của method giữ nguyên không đổi.)

- [ ] **Step 4: Sửa `resolveUniqueSlug` — bỏ qua danh mục đã xóa mềm**

Thay:

```ts
    while (
      await this.prisma.category.findFirst({
        where: {
          slug: candidate,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    ) {
```

bằng:

```ts
    while (
      await this.prisma.category.findFirst({
        where: {
          slug: candidate,
          isDelete: false,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })
    ) {
```

- [ ] **Step 5: Sửa `computeSubtreeHeight` — con đã xóa mềm không tính vào chiều cao cây**

Thay:

```ts
  private async computeSubtreeHeight(id: string): Promise<number> {
    const children = await this.prisma.category.findMany({
      where: { parentId: id },
      select: { id: true },
    });
```

bằng:

```ts
  private async computeSubtreeHeight(id: string): Promise<number> {
    const children = await this.prisma.category.findMany({
      where: { parentId: id, isDelete: false },
      select: { id: true },
    });
```

- [ ] **Step 6: Sửa `reorder()` — loại danh mục đã xóa mềm khỏi tập hợp lệ**

Thay dòng đầu của `reorder()`:

```ts
  async reorder(dto: ReorderCategoriesDto): Promise<void> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true, name: true },
    });
```

bằng:

```ts
  async reorder(dto: ReorderCategoriesDto): Promise<void> {
    const all = await this.prisma.category.findMany({
      where: { isDelete: false },
      select: { id: true, parentId: true, name: true },
    });
```

(Phần thân còn lại của `reorder()` giữ nguyên — logic `NotFoundException` khi `parentId` không nằm trong `parentMap` đã tự đúng vì danh mục đã xóa mềm giờ không còn trong `all`.)

- [ ] **Step 7: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 8: Commit**

```bash
git add src/modules/categories/categories.service.ts
git commit -m "feat(categories): treat soft-deleted categories as invisible everywhere"
```

---

## Task 4: Backend — `findTree()` lọc theo `includeDeleted`

**Files:**
- Modify: `backend-cms/src/modules/categories/categories.service.ts`
- Modify: `backend-cms/src/modules/categories/categories.controller.ts`

**Interfaces:**
- Produces: `CategoriesService.findTree(includeInactive: boolean, includeDeleted: boolean): Promise<CategoryTreeNode[]>` (thêm tham số thứ 2, controller phải truyền đủ).

- [ ] **Step 1: Sửa `findTree()` trong service**

Thay:

```ts
  async findTree(includeInactive: boolean): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });

    return buildTree(categories);
  }
```

bằng:

```ts
  async findTree(
    includeInactive: boolean,
    includeDeleted: boolean,
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
```

- [ ] **Step 2: Sửa controller — thêm query `includeDeleted`**

Trong `backend-cms/src/modules/categories/categories.controller.ts`, tìm:

```ts
  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Lấy cây danh mục' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Admin dùng để xem cả danh mục đang ẩn',
  })
  @ApiResponse({ status: 200, description: 'Cây danh mục (nested children)' })
  findTree(@Query('includeInactive') includeInactive?: string) {
    return this.categoriesService.findTree(includeInactive === 'true');
  }
```

Thay bằng:

```ts
  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Lấy cây danh mục' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Admin dùng để xem cả danh mục đang ẩn',
  })
  @ApiQuery({
    name: 'includeDeleted',
    required: false,
    type: Boolean,
    description: 'Admin dùng để xem cả danh mục đã xóa mềm',
  })
  @ApiResponse({ status: 200, description: 'Cây danh mục (nested children)' })
  findTree(
    @Query('includeInactive') includeInactive?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.categoriesService.findTree(
      includeInactive === 'true',
      includeDeleted === 'true',
    );
  }
```

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 4: Commit**

```bash
git add src/modules/categories/categories.service.ts src/modules/categories/categories.controller.ts
git commit -m "feat(categories): filter tree by includeDeleted query param"
```

---

## Task 5: Backend — verify thủ công end-to-end (curl)

**Files:** không sửa file — chỉ chạy dev server và gọi API để xác nhận Task 1–4 hoạt động đúng.

- [ ] **Step 1: Khởi động dev server**

Run: `pnpm --filter @clothing-shop/be start:dev`, đợi log "Nest application successfully started". Đăng nhập lấy token:

```bash
curl -s -X POST http://localhost:3002/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@clothing-shop.com","password":"admin123"}'
```

Lưu `accessToken` vào biến `$TOKEN` cho các bước sau (`-H "Authorization: Bearer $TOKEN"`).

- [ ] **Step 2: Test xóa mềm danh mục lá (không con, không sản phẩm)**

Tạo 1 danh mục gốc `{"name":"Soft Del Test","image":null,"imagePublicId":null}`, lưu `id`. Gọi `DELETE /categories/:id`.

Expected: HTTP 200. Gọi `GET /categories` (không truyền gì) → danh mục KHÔNG xuất hiện. Gọi `GET /categories?includeDeleted=true` → danh mục XUẤT HIỆN, field `isDelete: true`.

- [ ] **Step 3: Test chặn xóa mềm khi còn con chưa xóa**

Tạo danh mục cha `Soft Del Cha`, tạo con `Soft Del Con` (parentId = cha). Gọi `DELETE /categories/:id` (id của cha).

Expected: HTTP 409 "Không thể xóa danh mục vì còn danh mục con bên trong".

- [ ] **Step 4: Test xóa mềm con trước, sau đó xóa mềm cha thành công**

Gọi `DELETE /categories/:id` (id của `Soft Del Con`) → 200. Gọi lại `DELETE /categories/:id` (id của `Soft Del Cha`) → giờ phải 200 (con đã xóa mềm không còn tính là "còn con").

- [ ] **Step 5: Test 404 khi thao tác lại danh mục đã xóa mềm**

Gọi `PATCH /categories/:id` (id của `Soft Del Con`, đã xóa mềm ở Step 4) với body `{"name":"abc"}`.

Expected: HTTP 404 "Không tìm thấy danh mục". Gọi lại `DELETE /categories/:id` (cùng id) → cũng 404.

- [ ] **Step 6: Test dùng lại tên/slug đã xóa mềm**

Tạo danh mục gốc mới với đúng tên `Soft Del Cha` (trùng tên với danh mục đã xóa mềm ở Step 4).

Expected: HTTP 201 — tạo thành công, không bị 409 trùng tên.

- [ ] **Step 7: Dọn dữ liệu test**

Xóa (mềm) toàn bộ danh mục vừa tạo qua `DELETE /categories/:id`, tắt dev server.

---

## Task 6: Frontend — cập nhật type và fix bug thiếu tham số

**Files:**
- Modify: `frontend-admin/src/types/shared-types.ts:36-50`
- Modify: `frontend-admin/src/hooks/useCategories.ts:28-33`

**Interfaces:**
- Consumes: response BE giờ có thêm field `isDelete: boolean` (Task 1–2).

- [ ] **Step 1: Thêm `isDelete` vào `CategoryNode`**

Trong `frontend-admin/src/types/shared-types.ts`, tìm:

```ts
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  imagePublicId: string | null;
  isActive: boolean;
  sortOrder: number;
  parentId: string | null;
  // Số sản phẩm gán trực tiếp vào danh mục này — không cộng dồn từ danh mục con.
  productCount: number;
  createdAt: string;
  updatedAt: string;
  children: CategoryNode[];
}
```

Thay bằng (thêm `isDelete` ngay sau `isActive`):

```ts
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  imagePublicId: string | null;
  isActive: boolean;
  isDelete: boolean;
  sortOrder: number;
  parentId: string | null;
  // Số sản phẩm gán trực tiếp vào danh mục này — không cộng dồn từ danh mục con.
  productCount: number;
  createdAt: string;
  updatedAt: string;
  children: CategoryNode[];
}
```

- [ ] **Step 2: Fix `useCategoryTreeIncludingDeleted()` thiếu tham số**

Trong `frontend-admin/src/hooks/useCategories.ts`, tìm:

```ts
export function useCategoryTreeIncludingDeleted() {
  return useQuery({
    queryKey: CATEGORIES_ALL_KEY,
    queryFn: () => getCategoryTree(true),
  });
}
```

Thay bằng:

```ts
export function useCategoryTreeIncludingDeleted() {
  return useQuery({
    queryKey: CATEGORIES_ALL_KEY,
    queryFn: () => getCategoryTree(true, true),
  });
}
```

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/cms lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/cms build`
Expected: build qua (`tsc -b && vite build`).

- [ ] **Step 4: Commit**

```bash
git add src/types/shared-types.ts src/hooks/useCategories.ts
git commit -m "feat(categories): add isDelete to CategoryNode, fix includeDeleted param bug"
```

---

## Task 7: Frontend — verify thủ công trên trình duyệt

**Files:** không sửa file — chỉ chạy `pnpm dev` (cả 2 repo) và thao tác tay để xác nhận tích hợp đúng.

- [ ] **Step 1: Khởi động cả 2 dev server**

Run: `pnpm --filter @clothing-shop/be start:dev` (backend-cms) và `pnpm --filter @clothing-shop/cms dev` (frontend-admin). Mở `/categories`, đăng nhập admin nếu cần.

- [ ] **Step 2: Test xóa danh mục qua UI**

Tạo 1 danh mục test (không con, không sản phẩm). Bấm nút xóa (icon thùng rác) → xác nhận trong `ConfirmModal`.

Expected: toast "Đã xóa danh mục", danh mục biến mất khỏi cây ngay (giống hệt UX xóa cứng cũ — không có gì khác biệt về mặt hiển thị).

- [ ] **Step 3: Test tạo lại đúng tên vừa xóa**

Bấm "Thêm danh mục", đặt đúng tên danh mục vừa xóa ở Step 2.

Expected: tạo thành công (không bị báo trùng tên) — xác nhận qua UI hành vi khớp quyết định "cho phép dùng lại tên đã xóa mềm".

- [ ] **Step 4: Dọn dữ liệu test**

Xóa danh mục tạo ở Step 3 qua UI, tắt cả 2 dev server.
