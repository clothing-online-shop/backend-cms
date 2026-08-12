# Collection Lifecycle Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chặn các thao tác trái với vòng đời Collection (UPCOMING/RUNNING/ENDED) — sửa/xóa Collection, gán/gỡ sản phẩm cả 2 chiều — theo đúng bộ error code Collection/Product mà FE đã chuẩn bị sẵn nhưng BE chưa dùng.

**Architecture:** `CollectionsService` tính `status` hiện tại bằng `withStatus()` (đã có) ngay trong `create()`/`update()`/`remove()`/`assignProducts()`/`removeProduct()`, so field nào thực sự đổi trước khi quyết định chặn hay cho qua. `ProductsService.assertCollectionsExist()` (helper dùng chung cho `create()` và `assignCollections()`) đổi từ chỉ đếm số lượng sang fetch thêm `endDate` để phát hiện collection ENDED. `removeFromCollection()` thêm 1 bước kiểm tra tương tự. Lỗi ném kèm `code` (qua `AllExceptionsFilter` đã hỗ trợ forward field này) để FE tự map sang đúng message tiếng Việt cố định đã có trong `ERROR_CODE_MESSAGE`.

**Tech Stack:** NestJS + Prisma (`backend-cms`), React + TypeScript (`frontend-admin`). Không thêm thư viện mới.

## Global Constraints

- Message tiếng Việt trong mọi `throw` phải khớp **chính xác từng chữ** với `ERROR_CODE_MESSAGE` tương ứng trong `frontend-admin/src/lib/errorCodes.ts` — FE ưu tiên dùng message tự map theo `code`, nhưng field `message` từ BE vẫn phải đúng vì đó là fallback khi code không khớp và là nguồn message hiển thị trong log/Swagger.
- Giá trị số trong `ErrorCode` phải khớp chính xác với `frontend-admin/src/lib/errorCodes.ts` (2 file không share type được).
- `COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED` dùng chung cho cả gán VÀ gỡ sản phẩm phía Collection (`assignProducts()`, `removeProduct()`) — message có sẵn "...không thể gán/gỡ sản phẩm" đã bao trọn cả 2 chiều.
- `PRODUCT_COLLECTION_ENDED` (phía Product, `assertCollectionsExist()`) chỉ dùng cho hành vi GÁN (message có sẵn chỉ nói "gán") — `removeFromCollection()` (gỡ phía Product) dùng message thường, không kèm code, vì FE chưa có code dựng sẵn riêng cho case này.
- Không nằm trong danh sách module bắt buộc automated test (`CLAUDE.md` chỉ bắt buộc Auth/Orders/Payments) — mỗi task xác nhận bằng lint + build, cộng 1 task verify thủ công bằng curl (BE) và trình duyệt (FE) ở cuối.

---

## Task 1: Backend — hạ tầng error code (giống pattern đã dùng cho Category, làm lại trên branch mới)

**Files:**
- Create: `backend-cms/src/common/constants/error-codes.ts`
- Modify: `backend-cms/src/common/filters/http-exception.filter.ts`

**Interfaces:**
- Produces: `ErrorCode.COLLECTION_DELETE_BLOCKED_RUNNING` (1101), `ErrorCode.COLLECTION_START_DATE_IN_PAST` (1102), `ErrorCode.COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING` (1103), `ErrorCode.COLLECTION_UPDATE_BLOCKED_ENDED` (1104), `ErrorCode.COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED` (1105), `ErrorCode.PRODUCT_COLLECTION_ENDED` (1212) — khớp giá trị số với `frontend-admin/src/lib/errorCodes.ts`. `AllExceptionsFilter` forward field `code` trong response lỗi.

- [ ] **Step 1: Tạo file error codes**

Tạo `backend-cms/src/common/constants/error-codes.ts`:

```ts
export const ErrorCode = {
  COLLECTION_DELETE_BLOCKED_RUNNING: 1101,
  COLLECTION_START_DATE_IN_PAST: 1102,
  COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING: 1103,
  COLLECTION_UPDATE_BLOCKED_ENDED: 1104,
  COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED: 1105,
  PRODUCT_COLLECTION_ENDED: 1212,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

- [ ] **Step 2: Forward field `code` trong `AllExceptionsFilter`**

Trong `backend-cms/src/common/filters/http-exception.filter.ts`, sau khối tính `error`, thêm:

```ts
    const error =
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'error' in exceptionResponse
        ? (exceptionResponse as Record<string, unknown>).error
        : HttpStatus[statusCode];

    const code =
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'code' in exceptionResponse
        ? (exceptionResponse as Record<string, unknown>).code
        : undefined;
```

Và sửa khối `response.status(statusCode).json({...})` ở cuối method:

```ts
    response.status(statusCode).json({
      statusCode,
      message,
      error,
      ...(code !== undefined ? { code } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
```

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 4: Commit**

```bash
git add src/common/constants/error-codes.ts src/common/filters/http-exception.filter.ts
git commit -m "feat(collections): add error code infra for lifecycle rules"
```

---

## Task 2: Backend — `create()`/`update()`/`remove()` của Collection theo đúng trạng thái

**Files:**
- Modify: `backend-cms/src/modules/collections/collections.service.ts`

**Interfaces:**
- Consumes: `ErrorCode` (Task 1), `CollectionStatus` (đã import sẵn trong file), `withStatus()`/`toDateOnly()` (đã có sẵn trong file, dùng lại).
- Produces: hàm module-level `assertStartDateNotInPast(startDate: string): void` — dùng lại ở `create()` và `update()`.

- [ ] **Step 1: Thêm import `ConflictException` và `ErrorCode`**

Trong `backend-cms/src/modules/collections/collections.service.ts`, sửa import đầu file:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

thành:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

Thêm ngay dưới các import khác:

```ts
import { ErrorCode } from '../../common/constants/error-codes';
```

- [ ] **Step 2: Thêm hàm `assertStartDateNotInPast`**

Thêm ngay sau hàm `assertDateRange` (cuối file, cùng nhóm free function với `toDateOnly`):

```ts
function assertStartDateNotInPast(startDate: string): void {
  if (toDateOnly(new Date(startDate)) < toDateOnly(new Date())) {
    throw new ConflictException({
      message: 'Ngày bắt đầu không được ở trong quá khứ.',
      code: ErrorCode.COLLECTION_START_DATE_IN_PAST,
    });
  }
}
```

(`toDateOnly` đã định nghĩa phía trên trong cùng file — hàm mới này phải đặt SAU `toDateOnly` để dùng được.)

- [ ] **Step 3: Gọi trong `create()`**

Trong method `create()`:

```ts
  async create(dto: CreateCollectionDto): Promise<CollectionWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    const slug = await this.resolveUniqueSlug(dto.name);
```

thêm 1 dòng:

```ts
  async create(dto: CreateCollectionDto): Promise<CollectionWithStatus> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(dto.startDate);
    const slug = await this.resolveUniqueSlug(dto.name);
```

- [ ] **Step 4: Sửa `update()` — chặn theo trạng thái**

Thay toàn bộ method `update()` hiện tại:

```ts
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
```

bằng:

```ts
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
      dto.description !== undefined &&
      dto.description !== existing.description;

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
```

- [ ] **Step 5: Sửa `remove()` — chặn khi RUNNING**

Thay:

```ts
  async remove(id: string): Promise<void> {
    await this.findExisting(id);
    await this.prisma.collection.delete({ where: { id } });
  }
```

bằng:

```ts
  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    if (withStatus(existing).status === CollectionStatus.RUNNING) {
      throw new ConflictException({
        message:
          'Không thể xóa bộ sưu tập đang diễn ra — đợi kết thúc hoặc sửa lại ngày kết thúc trước khi xóa.',
        code: ErrorCode.COLLECTION_DELETE_BLOCKED_RUNNING,
      });
    }
    await this.prisma.collection.delete({ where: { id } });
  }
```

- [ ] **Step 6: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 7: Commit**

```bash
git add src/modules/collections/collections.service.ts
git commit -m "feat(collections): enforce lifecycle rules on create/update/remove"
```

---

## Task 3: Backend — `assignProducts()`/`removeProduct()` chặn khi Collection đã ENDED

**Files:**
- Modify: `backend-cms/src/modules/collections/collections.service.ts`

**Interfaces:**
- Consumes: `ErrorCode.COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED` (Task 1).

- [ ] **Step 1: Sửa `assignProducts()`**

Thay:

```ts
  async assignProducts(
    collectionId: string,
    dto: AssignProductsDto,
  ): Promise<void> {
    await this.findExisting(collectionId);
    // Dedupe trước khi ghi — client gửi trùng id sẽ đụng @@unique([collectionId,
    // productId]) và ném P2002 thô nếu không lọc trước.
    const productIds = [...new Set(dto.productIds)];
```

bằng:

```ts
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
```

(Phần thân còn lại của method giữ nguyên không đổi.)

- [ ] **Step 2: Sửa `removeProduct()`**

Thay:

```ts
  async removeProduct(collectionId: string, productId: string): Promise<void> {
    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { collectionId, productId },
    });
    if (count === 0) {
      throw new NotFoundException('Bộ sưu tập không chứa sản phẩm này');
    }
  }
```

bằng:

```ts
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
```

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 4: Commit**

```bash
git add src/modules/collections/collections.service.ts
git commit -m "feat(collections): block assign/remove products on ended collection"
```

---

## Task 4: Backend — Product-side: chặn gán vào Collection đã ENDED (`create()` + `assignCollections()`), chặn gỡ (`removeFromCollection()`)

**Files:**
- Modify: `backend-cms/src/modules/products/products.service.ts`

**Interfaces:**
- Consumes: `ErrorCode.PRODUCT_COLLECTION_ENDED` (Task 1).
- Produces: hàm module-level `isCollectionEnded(endDate: Date): boolean`.

- [ ] **Step 1: Thêm import `ErrorCode`**

Thêm ngay dưới import cuối cùng hiện có (`UpdateStockDto`):

```ts
import { ErrorCode } from '../../common/constants/error-codes';
```

- [ ] **Step 2: Thêm hàm `isCollectionEnded`**

Thêm vào cuối file, cạnh các free function khác (`assertNoDuplicateVariants`,
`assertImagesPublicIdsAligned`):

```ts
// So sánh theo ngày lịch (bỏ qua giờ), khớp cách CollectionsService.withStatus() tính
// trạng thái ENDED — collection kết thúc "hôm nay" vẫn coi là còn hiệu lực tới hết ngày.
function isCollectionEnded(endDate: Date): boolean {
  const toDateOnly = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return toDateOnly(new Date()) > toDateOnly(endDate);
}
```

- [ ] **Step 3: Sửa `assertCollectionsExist()` — thêm check ENDED**

Thay:

```ts
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
```

bằng:

```ts
  private async assertCollectionsExist(collectionIds: string[]): Promise<void> {
    const uniqueIds = new Set(collectionIds);
    const collections = await this.prisma.collection.findMany({
      where: { id: { in: [...uniqueIds] } },
      select: { id: true, endDate: true },
    });
    if (collections.length !== uniqueIds.size) {
      throw new BadRequestException(
        'Có bộ sưu tập không tồn tại trong danh sách gán',
      );
    }
    if (collections.some((collection) => isCollectionEnded(collection.endDate))) {
      throw new ConflictException({
        message:
          'Có bộ sưu tập đã kết thúc trong danh sách gán — không thể gán sản phẩm vào bộ sưu tập đã kết thúc.',
        code: ErrorCode.PRODUCT_COLLECTION_ENDED,
      });
    }
  }
```

(Method này dùng chung bởi `create()` và `assignCollections()` — cả 2 tự động được bảo vệ,
không cần sửa gì thêm ở 2 method đó.)

- [ ] **Step 4: Sửa `removeFromCollection()`**

Thay:

```ts
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
```

bằng:

```ts
  async removeFromCollection(
    productId: string,
    collectionId: string,
  ): Promise<void> {
    const collection = await this.prisma.collection.findUnique({
      where: { id: collectionId },
      select: { endDate: true },
    });
    if (!collection) {
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
```

- [ ] **Step 5: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/products.service.ts
git commit -m "feat(products): block assigning to or removing from ended collection"
```

---

## Task 5: Backend — verify thủ công end-to-end (curl)

**Files:** không sửa file — chỉ chạy dev server và gọi API để xác nhận Task 1–4.

- [ ] **Step 1: Khởi động dev server + đăng nhập**

Run: `pnpm --filter @clothing-shop/be start:dev`, đợi log "Nest application successfully started". Đăng nhập lấy token:

```bash
curl -s -X POST http://localhost:3002/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@clothing-shop.com","password":"admin123"}'
```

- [ ] **Step 2: Test tạo Collection với ngày bắt đầu ở quá khứ**

`POST /collections` body có `startDate` là ngày hôm qua.

Expected: HTTP 409, `code: 1102`.

- [ ] **Step 3: Test sửa Collection đang RUNNING**

Tạo 1 Collection với `startDate` hôm nay, `endDate` 7 ngày sau (→ RUNNING ngay). `PATCH /collections/:id` đổi `name` → expect 409 `code: 1103`. `PATCH` chỉ đổi `banner` → expect 200 (thành công).

- [ ] **Step 4: Test xóa Collection đang RUNNING, rồi test khi ENDED**

`DELETE /collections/:id` (collection RUNNING ở Step 3) → expect 409 `code: 1101`.

Vì `create()` chặn `startDate` ở quá khứ (Step 2), không thể tạo thẳng 1 Collection ENDED
qua API. Để có dữ liệu test ENDED: tạo Collection với `startDate` hôm nay, `endDate` hôm nay
(→ RUNNING ngay), rồi mở `pnpm --filter @clothing-shop/be prisma:studio` sửa tay `endDate`
của bản ghi đó xuống 1 ngày trong quá khứ (mô phỏng trạng thái ENDED cho mục đích test).
`DELETE /collections/:id` collection ENDED này → expect 200.

- [ ] **Step 5: Test sửa Collection đã ENDED**

`PATCH /collections/:id` (collection ENDED ở Step 4, tạo lại 1 bản khác nếu bản cũ đã xóa) đổi bất kỳ field (kể cả banner) → expect 409 `code: 1104`.

- [ ] **Step 6: Test gán/gỡ sản phẩm vào Collection đã ENDED**

`PUT /collections/:id/products` (collection ENDED) với `productIds` bất kỳ → expect 409 `code: 1105`. `DELETE /collections/:id/products/:productId` (collection ENDED) → expect 409 `code: 1105`.

- [ ] **Step 7: Test tạo sản phẩm kèm `collectionIds` trỏ tới Collection đã ENDED**

`POST /products` với `collectionIds: [<id collection ENDED>]` → expect 409 `code: 1212`. Test tương tự qua `PUT /products/:id/collections`.

- [ ] **Step 8: Test gỡ sản phẩm khỏi Collection đã ENDED (chiều Product)**

`DELETE /products/:id/collections/:collectionId` (collection ENDED) → expect 400 (không kèm code, message "Bộ sưu tập đã kết thúc — không thể gỡ sản phẩm khỏi bộ sưu tập đã kết thúc.").

- [ ] **Step 9: Dọn dữ liệu test, tắt dev server**

Xóa các Collection/Product test tạo ra qua API (Collection UPCOMING/ENDED xóa được bình thường), tắt dev server.

---

## Task 6: Frontend — cảnh báo khi xóa sản phẩm đang thuộc Collection

**Files:**
- Modify: `frontend-admin/src/pages/products/ProductList.tsx`

**Interfaces:**
- Consumes: `ProductListItem.collections: { id: string; name: string; slug: string }[]` (đã có sẵn trong `types/shared-types.ts`, không cần sửa type).

- [ ] **Step 1: Tính description động cho `ConfirmModal`**

Trong `frontend-admin/src/pages/products/ProductList.tsx`, tìm khối `<ConfirmModal ... />` cuối
file:

```tsx
      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Thông báo"
        description="Bạn có chắc chắn muốn xóa sản phẩm này không?"
        confirmText="Đồng ý"
        cancelText="Hủy"
        danger
      />
```

Thay bằng:

```tsx
      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Thông báo"
        description={
          deleteTarget && deleteTarget.collections.length > 0
            ? `Bạn có chắc chắn muốn xóa sản phẩm này không? Sản phẩm đang thuộc bộ sưu tập: ${deleteTarget.collections
                .map((c) => c.name)
                .join(", ")} — xóa sản phẩm sẽ tự động gỡ khỏi các bộ sưu tập này.`
            : "Bạn có chắc chắn muốn xóa sản phẩm này không?"
        }
        confirmText="Đồng ý"
        cancelText="Hủy"
        danger
      />
```

- [ ] **Step 2: Lint + build**

Run: `pnpm --filter @clothing-shop/cms lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/cms build`
Expected: build qua.

- [ ] **Step 3: Commit**

```bash
git add src/pages/products/ProductList.tsx
git commit -m "feat(products): warn before deleting a product assigned to collections"
```

---

## Task 7: Frontend — verify thủ công trên trình duyệt

**Files:** không sửa file — chỉ chạy `pnpm dev` (cả 2 repo) và thao tác tay.

- [ ] **Step 1: Khởi động cả 2 dev server**

Run: `pnpm --filter @clothing-shop/be start:dev` và `pnpm --filter @clothing-shop/cms dev`. Đăng nhập admin.

- [ ] **Step 2: Test cảnh báo xóa sản phẩm đã gán collection**

Vào `/products`, gán 1 sản phẩm vào 1 bộ sưu tập bất kỳ qua form sửa sản phẩm (bước
`ProductCollectionsStep`) hoặc qua `AssignProductsModal` ở trang Collection. Quay lại
`/products`, bấm xóa sản phẩm đó.

Expected: `ConfirmModal` hiện dòng cảnh báo liệt kê đúng tên bộ sưu tập.

- [ ] **Step 3: Test luồng Collection RUNNING/ENDED trên UI**

Vào `/collections`, thử sửa tên 1 bộ sưu tập đang diễn ra (nếu có sẵn) hoặc tạo mới 1 bộ
sưu tập với ngày bắt đầu hôm nay để nó RUNNING ngay, rồi thử đổi tên → xác nhận toast lỗi
hiện đúng message "Bộ sưu tập đang diễn ra — không thể đổi tên hoặc ngày bắt đầu...".

- [ ] **Step 4: Dọn dữ liệu test**

Xóa các Collection/Product test tạo ra qua UI (chỉ xóa được khi không còn RUNNING), tắt cả
2 dev server.
