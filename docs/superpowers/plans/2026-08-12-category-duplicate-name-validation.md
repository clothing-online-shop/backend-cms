# Category Duplicate-Name Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chặn tạo/sửa/kéo-thả danh mục ra tên trùng với danh mục khác cùng cha (không phân biệt hoa/thường), cả ở backend (nguồn sự thật) và frontend (chặn ngay khi kéo-thả, không nhảy-rồi-bật-lại).

**Architecture:** `CategoriesService` (backend-cms) nhận thêm 1 helper check trùng tên theo `parentId`, gọi từ `create()`/`update()` (check 1 node) và `reorder()` (check theo lô, chỉ trong các nhóm cha thực sự nhận node mới). Lỗi trùng tên ném `ConflictException` kèm `code: 1001` — field `code` này được `AllExceptionsFilter` forward ra response lần đầu tiên (hạ tầng còn thiếu). Frontend (`CategoryList.tsx`) thêm 1 bước check tên trùng ngay trong `handleDrop()` trước khi optimistic-update UI, dùng chính `treeData` đang có sẵn trên client — không gọi API riêng để check.

**Tech Stack:** NestJS + Prisma (`backend-cms`), React + TypeScript (`frontend-admin`). Không thêm thư viện mới.

## Global Constraints

- So tên: `name.trim().toLowerCase()` — không phân biệt hoa/thường, khớp convention `assertNoDuplicateVariants` trong `products.service.ts`.
- Chỉ chặn trùng tên giữa các danh mục **cùng cha trực tiếp** (kể cả nhóm gốc `parentId = null`). Không làm rule "tên trùng tổ tiên" (ngoài phạm vi — xem spec).
- Không thêm DB constraint — check ở tầng service, theo đúng pattern hiện có của `resolveUniqueSlug`.
- `reorder()` chỉ check trong (các) nhóm cha **thực sự nhận node mới** ở lần gọi đó (so với `parentId` cũ trong DB) — không quét toàn cây, tránh chặn nhầm do dữ liệu trùng tên có sẵn từ trước ở nhánh không liên quan.
- Categories không nằm trong danh sách module bắt buộc có automated test (`CLAUDE.md` backend-cms chỉ bắt buộc Auth/Orders/Payments) — mỗi task xác nhận bằng lint + build (bắt buộc trước PR theo `CLAUDE.md`), cộng 1 task riêng verify thủ công bằng curl (BE) và trình duyệt (FE) ở cuối.
- Message tiếng Việt hiển thị cho user kết thúc bằng dấu chấm.

---

## Task 1: Backend — hạ tầng error code (`code` field trong response lỗi)

**Files:**
- Create: `backend-cms/src/common/constants/error-codes.ts`
- Modify: `backend-cms/src/common/filters/http-exception.filter.ts`

**Interfaces:**
- Produces: `ErrorCode.CATEGORY_NAME_DUPLICATE` (giá trị số `1001`, khớp `frontend-admin/src/lib/errorCodes.ts`). `AllExceptionsFilter` forward field `code` (number, optional) trong JSON response khi exception được ném kèm `{ message, code }`.

- [ ] **Step 1: Tạo file error codes**

Tạo `backend-cms/src/common/constants/error-codes.ts`:

```ts
export const ErrorCode = {
  CATEGORY_NAME_DUPLICATE: 1001,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

- [ ] **Step 2: Forward field `code` trong `AllExceptionsFilter`**

Trong `backend-cms/src/common/filters/http-exception.filter.ts`, sau khối tính `error` (đang đọc field `error` từ `exceptionResponse`), thêm khối tính `code` tương tự:

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

Và sửa khối `response.status(statusCode).json({...})` ở cuối method để chèn `code` khi có:

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
Expected: build qua, không lỗi TypeScript.

- [ ] **Step 4: Commit**

```bash
git add src/common/constants/error-codes.ts src/common/filters/http-exception.filter.ts
git commit -m "feat(categories): add error code infra for duplicate-name validation"
```

---

## Task 2: Backend — chặn trùng tên khi tạo/sửa danh mục

**Files:**
- Modify: `backend-cms/src/modules/categories/categories.service.ts`

**Interfaces:**
- Consumes: `ErrorCode.CATEGORY_NAME_DUPLICATE` từ `../../common/constants/error-codes` (Task 1).
- Produces: private method `assertNoDuplicateSiblingName(name: string, parentId: string | null, excludeId?: string): Promise<void>` trên `CategoriesService` — dùng lại ở Task 3.

- [ ] **Step 1: Thêm import `ErrorCode`**

Trong `backend-cms/src/modules/categories/categories.service.ts`, thêm import ngay dưới các import hiện có (sau dòng `import { ReorderCategoriesDto } from './dto/reorder-categories.dto';`):

```ts
import { ErrorCode } from '../../common/constants/error-codes';
```

- [ ] **Step 2: Thêm helper `assertNoDuplicateSiblingName`**

Thêm method private mới ngay sau `assertCategoryExists` (trước `assertNoCycle`):

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
    const normalized = name.trim().toLowerCase();
    const isDuplicate = siblings.some(
      (sibling) => sibling.name.trim().toLowerCase() === normalized,
    );
    if (isDuplicate) {
      throw new ConflictException({
        message: 'Đã tồn tại danh mục cùng tên trong cùng danh mục cha.',
        code: ErrorCode.CATEGORY_NAME_DUPLICATE,
      });
    }
  }
```

- [ ] **Step 3: Gọi helper trong `create()`**

Trong method `create()`, thêm dòng gọi `assertNoDuplicateSiblingName` ngay sau `assertDepthWithinLimit`, trước khi resolve slug:

```ts
  async create(dto: CreateCategoryDto): Promise<Category> {
    assertImagePublicIdAligned(dto.image, dto.imagePublicId);
    if (dto.parentId) {
      await this.assertCategoryExists(dto.parentId);
    }
    await this.assertDepthWithinLimit(dto.parentId ?? null);
    await this.assertNoDuplicateSiblingName(dto.name, dto.parentId ?? null);

    const slug = await this.resolveUniqueSlug(dto.slug ?? dto.name);
```

- [ ] **Step 4: Gọi helper trong `update()`**

Trong method `update()`, ngay sau khối `if (dto.parentId !== undefined && dto.parentId !== existing.parentId) { ... }` (trước dòng `const imageChanged = ...`), thêm:

```ts
    const nameChanged = dto.name !== undefined && dto.name !== existing.name;
    const parentChanged =
      dto.parentId !== undefined && dto.parentId !== existing.parentId;
    if (nameChanged || parentChanged) {
      const effectiveName = dto.name ?? existing.name;
      const effectiveParentId =
        dto.parentId === undefined ? existing.parentId : dto.parentId;
      await this.assertNoDuplicateSiblingName(effectiveName, effectiveParentId, id);
    }
```

- [ ] **Step 5: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 6: Commit**

```bash
git add src/modules/categories/categories.service.ts
git commit -m "feat(categories): reject duplicate sibling name on create/update"
```

---

## Task 3: Backend — chặn trùng tên khi kéo-thả (`reorder()`)

**Files:**
- Modify: `backend-cms/src/modules/categories/categories.service.ts`

**Interfaces:**
- Consumes: `ErrorCode.CATEGORY_NAME_DUPLICATE` (Task 1).
- Produces: private method `assertNoDuplicateNameInMovedGroups(parentMap: Map<string, string | null>, nameMap: Map<string, string>, movedIntoParents: Set<string | null>): void`.

- [ ] **Step 1: Thêm helper `assertNoDuplicateNameInMovedGroups`**

Thêm method private mới ngay sau `assertNoDuplicateSiblingName` (được thêm ở Task 2):

```ts
  // Chỉ so tên trong đúng (các) nhóm cha vừa nhận thêm node ở lần gọi này — không quét
  // toàn cây, để dữ liệu trùng tên có sẵn từ trước (trước khi có validate này) ở nhánh
  // không liên quan không làm chặn nhầm các thao tác kéo-thả khác.
  private assertNoDuplicateNameInMovedGroups(
    parentMap: Map<string, string | null>,
    nameMap: Map<string, string>,
    movedIntoParents: Set<string | null>,
  ): void {
    if (movedIntoParents.size === 0) return;

    const seenByParent = new Map<string | null, Set<string>>();
    for (const [id, parentId] of parentMap) {
      if (!movedIntoParents.has(parentId)) continue;

      const seen = seenByParent.get(parentId) ?? new Set<string>();
      seenByParent.set(parentId, seen);

      const normalized = nameMap.get(id)!.trim().toLowerCase();
      if (seen.has(normalized)) {
        throw new ConflictException({
          message: 'Đã tồn tại danh mục cùng tên trong cùng danh mục cha.',
          code: ErrorCode.CATEGORY_NAME_DUPLICATE,
        });
      }
      seen.add(normalized);
    }
  }
```

- [ ] **Step 2: Sửa `reorder()` để fetch `name` và theo dõi `movedIntoParents`**

Thay toàn bộ method `reorder()` hiện tại bằng:

```ts
  async reorder(dto: ReorderCategoriesDto): Promise<void> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true, name: true },
    });
    const originalParentMap = new Map(all.map((c) => [c.id, c.parentId]));
    const nameMap = new Map(all.map((c) => [c.id, c.name]));
    const parentMap = new Map(originalParentMap);
    const movedIntoParents = new Set<string | null>();

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
      if (
        item.parentId !== undefined &&
        item.parentId !== originalParentMap.get(item.id)
      ) {
        movedIntoParents.add(item.parentId);
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

    this.assertNoDuplicateNameInMovedGroups(parentMap, nameMap, movedIntoParents);

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
```

(Thay đổi so với bản gốc: `findMany` select thêm `name`, thêm `originalParentMap`/`nameMap`/`movedIntoParents`, thêm nhánh cập nhật `movedIntoParents` trong vòng `for (const item of dto.items)`, và gọi `assertNoDuplicateNameInMovedGroups` trước `$transaction`. Vòng lặp check cycle/depth giữ nguyên y hệt bản gốc.)

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/be build`
Expected: build qua.

- [ ] **Step 4: Commit**

```bash
git add src/modules/categories/categories.service.ts
git commit -m "feat(categories): reject duplicate sibling name on drag-drop reorder"
```

---

## Task 4: Backend — verify thủ công end-to-end (curl)

**Files:** không sửa file — chỉ chạy dev server và gọi API để xác nhận Task 1–3 hoạt động đúng.

- [ ] **Step 1: Khởi động dev server**

Run: `pnpm --filter @clothing-shop/be start:dev` (chạy nền, đợi log "Nest application successfully started").

- [ ] **Step 2: Test tạo trùng tên cùng cha**

Tạo 1 danh mục gốc tên "Áo nam" (`POST /categories` body `{"name":"Áo nam"}`), sau đó tạo tiếp danh mục gốc thứ 2 tên "áo NAM " (cùng `parentId: null`).

Expected: request thứ 2 trả HTTP 409, body chứa `"code":1001` và `"message":"Đã tồn tại danh mục cùng tên trong cùng danh mục cha."`.

- [ ] **Step 3: Test sửa tên thành trùng**

Tạo thêm 1 danh mục gốc tên "Áo nữ". Gọi `PATCH /categories/:id` (id của "Áo nữ") với body `{"name":"Áo nam"}`.

Expected: HTTP 409, `code: 1001`.

- [ ] **Step 4: Test kéo-thả (reorder) vào nhóm đã có tên trùng**

Tạo danh mục con "Quần" dưới "Áo nam" (`parentId` = id của "Áo nam"). Tạo tiếp 1 danh mục gốc khác tên "Quần" (`parentId: null`). Gọi `POST /categories/reorder` với `items` gồm: danh mục gốc "Quần" đổi `parentId` sang id của "Áo nam" (cùng nhóm với con "Quần" đã có), giữ nguyên `sortOrder`/`parentId` của các category còn lại đúng trạng thái hiện tại của chúng.

Expected: HTTP 409, `code: 1001`, và category "Quần" gốc vẫn còn `parentId: null` trong DB (transaction không chạy).

- [ ] **Step 5: Dọn dữ liệu test**

Xóa các danh mục vừa tạo ở Step 2–4 qua `DELETE /categories/:id` (không còn sản phẩm/con bên trong nên xóa được), tắt dev server.

---

## Task 5: Frontend — chặn kéo-thả ngay khi phát hiện trùng tên

**Files:**
- Modify: `frontend-admin/src/pages/categories/CategoryList.tsx:76-276`

**Interfaces:**
- Produces: hàm module-level `findContainingArray(nodes: CategoryTreeNode[], key: string): CategoryTreeNode[] | null`.
- Consumes: `CategoryTreeNode`, `findNodeInTree`, `containsKey`, `toast` — đã có sẵn trong file.

- [ ] **Step 1: Thêm helper `findContainingArray`**

Trong `frontend-admin/src/pages/categories/CategoryList.tsx`, thêm hàm mới ngay sau `containsKey` (trước `export default function CategoryList()`):

```ts
// Trả về mảng (danh sách anh em, bao gồm chính node đó) đang chứa node có key này —
// dùng để lấy đúng danh sách "anh em" ở vị trí thả trước khi thực sự di chuyển, phục vụ
// check trùng tên ngay trong handleDrop().
function findContainingArray(
  nodes: CategoryTreeNode[],
  key: string,
): CategoryTreeNode[] | null {
  if (nodes.some((node) => node.key === key)) return nodes;
  for (const node of nodes) {
    if (node.children) {
      const found = findContainingArray(node.children, key);
      if (found) return found;
    }
  }
  return null;
}
```

- [ ] **Step 2: Thêm check trùng tên đầu `handleDrop`, chặn trước khi optimistic-update**

Trong `handleDrop`, đoạn đầu hàm hiện tại là:

```ts
  async function handleDrop(dragKey: string, dropKey: string, position: "before" | "after" | "inside") {
    // dropKey nằm trong chính cây con của dragKey (thả 1 danh mục cha vào/trước/sau
    // con-cháu của chính nó) — nếu cho phép, bước "loop" bên dưới tìm dropKey trên cây
    // đã bị gỡ dragObj ra nên không thấy, cả nhánh dragObj biến mất khỏi UI cho tới khi
    // refetch. Chặn sớm thay vì để state bị hỏng tạm thời.
    const dragNode = findNodeInTree(treeData, dragKey);
    if (dragNode && containsKey(dragNode, dropKey)) {
      toast.error("Không thể chuyển danh mục vào chính danh mục con của nó");
      return;
    }

    const previousTreeData = treeData;
```

Sửa thành (thêm early-return khi `!dragNode`, và thêm khối check trùng tên trước dòng `const previousTreeData = treeData;`):

```ts
  async function handleDrop(dragKey: string, dropKey: string, position: "before" | "after" | "inside") {
    // dropKey nằm trong chính cây con của dragKey (thả 1 danh mục cha vào/trước/sau
    // con-cháu của chính nó) — nếu cho phép, bước "loop" bên dưới tìm dropKey trên cây
    // đã bị gỡ dragObj ra nên không thấy, cả nhánh dragObj biến mất khỏi UI cho tới khi
    // refetch. Chặn sớm thay vì để state bị hỏng tạm thời.
    const dragNode = findNodeInTree(treeData, dragKey);
    if (dragNode && containsKey(dragNode, dropKey)) {
      toast.error("Không thể chuyển danh mục vào chính danh mục con của nó");
      return;
    }
    if (!dragNode) return;

    // Check trùng tên NGAY tại đây (dùng treeData hiện có trên client, chưa đổi gì) để
    // chặn trước khi optimistic-update UI — tránh hiệu ứng nhảy vị trí rồi bật lại mà
    // vẫn chặn được đúng case "chỗ thả đã có danh mục tên như vậy". BE (reorder()) vẫn
    // check lại — lưới an toàn cho race condition 2 admin thao tác cùng lúc.
    const dragName = (typeof dragNode.title === "string" ? dragNode.title : "")
      .trim()
      .toLowerCase();
    const targetSiblings =
      position === "inside"
        ? (findNodeInTree(treeData, dropKey)?.children ?? [])
        : (findContainingArray(treeData, dropKey) ?? []);
    const hasDuplicateName = targetSiblings.some(
      (sibling) =>
        sibling.key !== dragKey &&
        (typeof sibling.title === "string" ? sibling.title : "").trim().toLowerCase() ===
          dragName,
    );
    if (hasDuplicateName) {
      toast.error("Đã tồn tại danh mục cùng tên trong cùng danh mục cha.");
      return;
    }

    const previousTreeData = treeData;
```

Phần còn lại của `handleDrop` (từ `const data = cloneTree(treeData);` trở xuống, gồm cả khối `if (!dragObj) return;`) giữ nguyên không đổi.

- [ ] **Step 3: Lint + build**

Run: `pnpm --filter @clothing-shop/cms lint`
Expected: 0 lỗi.

Run: `pnpm --filter @clothing-shop/cms build`
Expected: build qua (`tsc -b && vite build`), không lỗi `noUnusedLocals`/`noUnusedParameters`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/categories/CategoryList.tsx
git commit -m "feat(categories): block drag-drop into duplicate-name target on client"
```

---

## Task 6: Frontend — verify thủ công trên trình duyệt

**Files:** không sửa file — chỉ chạy `pnpm dev` và thao tác tay trên UI để xác nhận Task 5 + tích hợp với BE (Task 1–3).

- [ ] **Step 1: Khởi động dev server**

Run: `pnpm --filter @clothing-shop/cms dev`, mở trang Danh mục (`/categories`) trên trình duyệt, đăng nhập admin nếu cần.

- [ ] **Step 2: Test form thêm/sửa trùng tên**

Tạo 2 danh mục gốc cùng tên (khác hoa/thường, vd "Áo Nam" và "áo nam"). Xác nhận danh mục thứ 2 bị chặn, toast hiện đúng: "Đã tồn tại danh mục cùng tên trong cùng danh mục cha."

- [ ] **Step 3: Test kéo-thả vào nhóm đã có tên trùng**

Tạo 1 danh mục con tên "Quần" dưới danh mục A, và 1 danh mục gốc khác cũng tên "Quần". Kéo danh mục gốc "Quần" thả `inside` vào danh mục A (nơi đã có con "Quần").

Expected: toast lỗi hiện ngay, **cây KHÔNG nhảy vị trí rồi bật lại** — vị trí "Quần" gốc giữ nguyên ngay từ đầu (không có hiệu ứng flash).

- [ ] **Step 4: Test kéo-thả hợp lệ vẫn hoạt động bình thường**

Kéo 1 danh mục sang vị trí không trùng tên (đổi cha hoặc đổi thứ tự bình thường).

Expected: toast "Đã cập nhật thứ tự danh mục", cây cập nhật đúng vị trí mới, refetch không đổi lại.

- [ ] **Step 5: Dọn dữ liệu test**

Xóa các danh mục tạo ở Step 2–3 qua UI (nút xóa), tắt dev server.
