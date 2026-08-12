# Xóa mềm danh mục (isDelete)

Ngày: 2026-08-12
Repo liên quan: `backend-cms` (schema + logic chính), `frontend-admin` (2 chỗ nhỏ)
Branch: tạo mới từ `develop` ở cả 2 repo (xem plan)

## Bối cảnh

`CategoriesService.remove()` hiện xóa cứng (`prisma.category.delete()`), chặn nếu còn
sản phẩm hoặc còn danh mục con. Yêu cầu: đổi sang xóa mềm bằng field `isDelete` (Boolean).
API lấy cây danh mục (`GET /categories`): không truyền tham số gì → mặc định chỉ lấy
`isDelete: false`; có truyền tham số → lấy cả `true` và `false`.

Phát hiện thêm khi khảo sát: `frontend-admin` đã có sẵn hạ tầng `includeDeleted` cho
**cả Categories, Collections, Products** (`categories-api.ts`, `collections-api.ts`,
`products-api.types.ts`) nhưng **backend-cms không xóa mềm ở bất kỳ module nào** — tất cả
đang hard-delete thật. Đây là lần thứ 2 gặp mẫu "FE code trước, BE chưa nối dây" trong dự
án này (lần đầu là `CATEGORY_NAME_DUPLICATE` error code). Phạm vi lần này **chỉ Categories**
theo đúng yêu cầu — không đụng Collections/Products.

Cũng phát hiện 1 bug có sẵn ở FE: `useCategoryTreeIncludingDeleted()`
(`hooks/useCategories.ts`) gọi `getCategoryTree(true)` — thiếu tham số thứ 2
(`includeDeleted`), nên dù comment nói "gồm cả danh mục đã xóa mềm" nhưng thực tế KHÔNG
truyền `includeDeleted: true` lên API. Sửa luôn trong lần này (đổi thành
`getCategoryTree(true, true)`).

## Quyết định thiết kế (đã chốt với user)

1. **Chặn xóa mềm khi còn sản phẩm/con**: giữ nguyên 2 check hiện có (như xóa cứng) — áp
   dụng luôn cho xóa mềm. Riêng "còn danh mục con" chỉ đếm con **chưa** bị xóa mềm
   (`isDelete: false`) — con đã xóa mềm từ trước không tính là "còn con" nữa, để không tự
   khóa vĩnh viễn việc dọn cây khi đã dọn hết con thật.
2. **Không cascade**: xóa mềm cha không tự động xóa mềm con — nhất quán với quyết định 1
   (muốn xóa cha phải xử lý con trước, y hệt logic xóa cứng cũ).
3. **Cho phép dùng lại tên/slug đã xóa mềm**: check trùng tên (`assertNoDuplicateSiblingName`)
   và check slug unique (`resolveUniqueSlug`) đều bỏ qua danh mục có `isDelete: true`.
4. **Chưa cần API khôi phục** trong lần này — hệ quả: danh mục đã xóa mềm coi như "đóng
   băng", không thể sửa, không thể được chọn làm cha mới ở nơi khác (xem mục Backend bên
   dưới, `assertCategoryExists`). Đây là hành vi chấp nhận được cho tới khi có tính năng
   khôi phục.

## Thay đổi Backend (`backend-cms`)

1. **`prisma/schema.prisma`**: thêm `isDelete Boolean @default(false)` vào model
   `Category`. Chạy `pnpm --filter @clothing-shop/be prisma:migrate` (migration name gợi ý:
   `add_category_is_delete`).

2. **`src/modules/categories/categories.service.ts`**:
   - `remove(id)`: đổi `this.prisma.category.delete({ where: { id } })` thành
     `this.prisma.category.update({ where: { id }, data: { isDelete: true } })`.
     `childrenCount` đổi query thành đếm `{ parentId: id, isDelete: false }` (trước là chỉ
     `{ parentId: id }`). Vẫn giữ nguyên logic dọn ảnh Cloudinary sau khi xóa mềm thành
     công — ảnh không còn hiển thị nên vẫn nên dọn như cũ.
   - `findTree(includeInactive, includeDeleted)`: thêm tham số `includeDeleted: boolean`
     (controller đọc từ query `includeDeleted`, cùng kiểu xử lý chuỗi `'true'` như
     `includeInactive` hiện có). `where` kết hợp cả 2 điều kiện độc lập:
     ```ts
     where: {
       ...(includeInactive ? {} : { isActive: true }),
       ...(includeDeleted ? {} : { isDelete: false }),
     }
     ```
   - `findBySlug(slug)`: sau khi `findUnique`, coi `category.isDelete === true` như không
     tìm thấy — đổi điều kiện `if (!category)` thành `if (!category || category.isDelete)`.
   - `assertCategoryExists(id)`: thêm `isDelete: false` vào `where` của `findUnique` — dùng
     chung bởi `update()`, `remove()`, và check `dto.parentId` tồn tại ở `create()`/
     `update()`. Hệ quả tự nhiên: không thể sửa/xóa lần 2 một danh mục đã xóa mềm (404), và
     không thể chọn 1 danh mục đã xóa mềm làm cha mới.
   - `reorder(dto)`: `findMany` ban đầu (lấy toàn bộ danh mục để build `parentMap`) thêm
     `where: { isDelete: false }` — id đã xóa mềm không nằm trong tập hợp lệ; nếu
     `dto.items` có `parentId` trỏ tới 1 id đã xóa mềm, `parentMap.has(item.parentId)` sẽ
     là `false` → ném `NotFoundException` y hệt trường hợp id không tồn tại (code cũ không
     đổi, tự đúng nhờ đổi nguồn dữ liệu).
   - `assertNoDuplicateSiblingName(name, parentId, excludeId?)`: thêm `isDelete: false` vào
     `where` khi query `siblings` — theo quyết định 3.
   - `resolveUniqueSlug(source, excludeId?)`: thêm `isDelete: false` vào `where` khi
     `findFirst` — theo quyết định 3.
   - `computeSubtreeHeight(id)`: thêm `isDelete: false` vào `where` khi `findMany` con — con
     đã xóa mềm không tính vào chiều cao cây con khi kiểm tra giới hạn độ sâu.

3. **`src/modules/categories/categories.controller.ts`**: thêm `@ApiQuery` +
   `@Query('includeDeleted')` cho `findTree`, truyền xuống service (mẫu y hệt
   `includeInactive` đã có).

## Thay đổi Frontend (`frontend-admin`)

1. **`src/types/shared-types.ts`**: thêm `isDelete: boolean` vào interface `CategoryNode`
   (khớp response BE, dùng đúng type có sẵn cho các trường hợp cần biết trạng thái xóa mềm
   sau này — hiện tại chưa có UI nào đọc field này).
2. **`src/hooks/useCategories.ts`**: sửa `useCategoryTreeIncludingDeleted()` — đổi
   `getCategoryTree(true)` thành `getCategoryTree(true, true)` (fix bug thiếu tham số đã
   nêu ở Bối cảnh).
3. **Không sửa `CategoryList.tsx`/`CategoryFormModal.tsx`**: nút xóa vẫn gọi
   `DELETE /categories/:id` y hệt hiện tại; `useCategoryTree()` (danh sách chính) không
   truyền `includeDeleted` nên danh mục xóa mềm tự động biến mất khỏi cây admin — đúng UX
   xóa hiện có, không cần đổi gì ở tầng UI.

## Testing

- BE: theo `CLAUDE.md`, categories không bắt buộc automated test — verify thủ công qua
  curl/Swagger (xóa mềm 1 danh mục lá → biến mất khỏi `GET /categories` mặc định, vẫn thấy
  khi truyền `includeDeleted=true`; xóa mềm danh mục còn con → vẫn bị chặn; tạo lại tên/slug
  trùng với danh mục đã xóa mềm → thành công; sửa/xóa lần 2 danh mục đã xóa mềm → 404), cộng
  `lint` + `build`.
- FE: verify thủ công trên `pnpm dev` — xóa 1 danh mục, xác nhận biến mất khỏi cây, cộng
  `lint` + `build`.
