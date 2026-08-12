# Chặn trùng tên danh mục cùng cha (tạo/sửa/kéo-thả)

Ngày: 2026-08-12
Repo liên quan: `backend-cms` (logic chính), `frontend-admin` (UX kéo-thả)
Branch: `backend-cms` → `fix/validate_categories`, `frontend-admin` → `fix/categoris_validaton`

## Bối cảnh

`CategoriesService` (`backend-cms/src/modules/categories/categories.service.ts`) hiện có
check độ sâu cây (`assertDepthWithinLimit`), check vòng lặp cha-con (`assertNoCycle`), và
check slug unique toàn hệ thống (`resolveUniqueSlug`) — nhưng **không** check trùng `name`
giữa các danh mục cùng `parentId`. Áp dụng cho cả 3 đường tạo ra dữ liệu: `create()`,
`update()`, và `reorder()` (endpoint FE gọi khi kéo-thả).

Phát hiện thêm trong lúc khảo sát: `frontend-admin/src/lib/errorCodes.ts` đã khai sẵn
`CATEGORY_NAME_DUPLICATE: 1001` kèm message tiếng Việt cố định trong
`ERROR_CODE_MESSAGE`, và `getErrorMessage()` (`lib/error.ts`) đã sẵn logic ưu tiên đọc
`error.response.data.code` để map sang message này. Nhưng phía `backend-cms` **chưa hề
có** file `error-codes.ts` hay bất kỳ exception nào gửi kèm field `code` — toàn bộ hệ
thống hiện throw exception chỉ có `message` thô (xem `assertNoDuplicateVariants` trong
`products.service.ts` làm ví dụ). Đây là phần hạ tầng còn thiếu cần bổ sung để dùng được
message đã chuẩn bị sẵn ở FE.

## Quyết định thiết kế

- **So sánh tên**: không phân biệt hoa/thường + trim (`name.trim().toLowerCase()`), khớp
  convention đã dùng ở `assertNoDuplicateVariants` (products.service.ts).
- **Phạm vi**: chỉ chặn trùng tên giữa các danh mục cùng **cha trực tiếp** (kể cả nhóm gốc,
  `parentId = null`). Không làm rule "tên trùng danh mục cha/tổ tiên" (code
  `CATEGORY_NAME_MATCHES_ANCESTOR = 1002` đã có sẵn ở FE nhưng ngoài phạm vi lần này).
- **Không thêm DB constraint**: Postgres unique index mặc định phân biệt hoa/thường, không
  diễn đạt được rule "không phân biệt hoa/thường" bằng constraint đơn giản. Giữ theo đúng
  pattern hiện có của `resolveUniqueSlug` — check ở tầng service, chấp nhận rủi ro race
  condition thấp (CMS nội bộ, ít admin thao tác đồng thời), nhất quán với cách slug đang
  được xử lý.
- **`reorder()` chỉ check nhóm cha thực sự bị đổi**: endpoint này nhận state của **toàn bộ
  cây** mỗi lần gọi (FE `collect()` duyệt hết cây, gửi lại `parentId`/`sortOrder` của mọi
  node, không chỉ node vừa kéo). Nếu check trùng tên trên toàn cây mỗi lần, một cặp trùng
  tên tồn tại từ trước (dữ liệu cũ, trước khi có validate này) ở nhánh không liên quan sẽ
  chặn nhầm các thao tác kéo-thả khác không đụng tới nhánh đó. Vì vậy chỉ kiểm tra trong
  đúng (các) nhóm cha mà lần gọi này thực sự đưa thêm node vào (so `parentId` mới khác
  `parentId` cũ trong DB) — đúng nghĩa "chỗ kéo vào đã có danh mục tên như vậy", không
  đụng phần cây không đổi.

## Thay đổi Backend (`backend-cms`)

1. **File mới** `src/common/constants/error-codes.ts`:
   ```ts
   export const ErrorCode = {
     CATEGORY_NAME_DUPLICATE: 1001,
   } as const;
   export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
   ```
   Chỉ khai code đang dùng thật (không khai trước các code khác của FE dành cho
   product/collection — tránh code chết, module nào cần thì tự thêm khi implement).

2. **`src/common/filters/http-exception.filter.ts`**: đọc thêm field `code` (nếu có) từ
   `exceptionResponse` theo đúng cách đang đọc `message`/`error`, forward vào JSON response
   cuối cùng. Không có `code` thì field này không xuất hiện trong response (giữ nguyên
   hành vi cũ cho mọi exception khác).

3. **`src/modules/categories/categories.service.ts`**:
   - Helper mới `assertNoDuplicateSiblingName(name, parentId, excludeId?)`: query các
     danh mục cùng `parentId`, so `name.trim().toLowerCase()`, loại trừ `excludeId` khi
     sửa. Trùng thì:
     ```ts
     throw new ConflictException({
       message: 'Đã tồn tại danh mục cùng tên trong cùng danh mục cha.',
       code: ErrorCode.CATEGORY_NAME_DUPLICATE,
     });
     ```
   - `create()`: gọi helper với `dto.parentId ?? null` trước khi insert.
   - `update()`: chỉ gọi khi `dto.name !== undefined` (đổi tên) hoặc `dto.parentId` thực
     sự khác `existing.parentId` (đổi cha) — tránh query thừa khi sửa field khác (ảnh,
     `isActive`...).
   - `reorder()`: fetch thêm `name` (cùng `id`/`parentId` đang fetch sẵn). Trong lúc build
     `parentMap`, theo dõi tập `movedIntoParents` (các `parentId` đích nhận ít nhất 1 node
     đổi cha thật sự so với DB). Sau khi có `parentMap` cuối cùng, với mỗi `parentId` trong
     `movedIntoParents`, gom toàn bộ node có `parentMap.get(id) === parentId`, so tên
     (trim + lowercase) — trùng thì ném lỗi như trên, không chạy transaction.

## Thay đổi Frontend (`frontend-admin`)

1. **`src/pages/categories/CategoryList.tsx`** → `handleDrop()`: trước khi optimistic
   update `treeData` và gọi `reorderMutation`, tính danh sách "anh em" ở đích thả:
   - Thả `inside`: children hiện có của node đích.
   - Thả `before`/`after`: mảng đang chứa node đích (cùng cấp).

   So tên (trim + lowercase, loại trừ chính node đang kéo) — trùng thì
   `toast.error("Đã tồn tại danh mục cùng tên trong cùng danh mục cha.")` và `return` ngay,
   **không** đổi `treeData`, không gọi API. Không còn hiệu ứng nhảy vị trí rồi bật lại cho
   trường hợp trùng tên phát hiện được ngay ở client.

   Logic revert khi BE từ chối (`setTreeData(previousTreeData)` trong `catch` của
   `handleDrop`) giữ nguyên — vẫn là lưới an toàn cho race condition (2 admin thao tác
   cùng lúc) hoặc trùng tên mà client chưa kịp thấy.

2. **`src/pages/categories/CategoryFormModal.tsx`**: **không cần sửa**. Đã dùng
   `toast.error(getErrorMessage(error))`, và `getErrorMessage()` đã tự map `code: 1001`
   sang đúng message tiếng Việt có sẵn trong `ERROR_CODE_MESSAGE`. Chỉ cần BE trả đúng
   `code` là form thêm/sửa tự động hiển thị đúng lỗi.

## Testing

- BE: theo `CLAUDE.md` chỉ bắt buộc unit/e2e test cho Auth/Orders/Payments — categories
  không nằm trong danh sách bắt buộc, nhưng nên test thủ công 3 luồng (tạo trùng tên cùng
  cha, sửa tên/đổi cha thành trùng, kéo-thả vào nhóm đã có tên trùng) qua Swagger/UI trước
  khi coi là xong, cộng `pnpm --filter @clothing-shop/be lint` + `build`.
- FE: test thủ công kéo-thả bị chặn ngay (không nhảy-rồi-bật-lại) trên
  `pnpm --filter @clothing-shop/cms dev`, cộng `lint` + `build`.
