# Ràng buộc vòng đời Collection ↔ Product (UPCOMING/RUNNING/ENDED)

Ngày: 2026-08-12
Repo liên quan: `backend-cms` (logic chính), `frontend-admin` (cảnh báo khi xóa product)
Branch: tạo mới từ `develop` ở cả 2 repo — `feature/collection-lifecycle-rules`

## Bối cảnh

`Collection` có trạng thái tính động (`CollectionStatus`: `UPCOMING`/`RUNNING`/`ENDED`,
suy ra từ `startDate`/`endDate` so với hôm nay, xem `withStatus()` trong
`collections.service.ts`) — không lưu DB. Hiện tại `create()`/`update()`/`remove()` của
Collection và `assignProducts()`/`removeProduct()`/`assignCollections()`/
`removeFromCollection()` (2 chiều Collection↔Product) đều chạy **vô điều kiện, không quan
tâm trạng thái** — có thể xóa 1 Collection đang chạy live, sửa tên/ngày 1 campaign đang
diễn ra, hay gán thêm sản phẩm vào 1 campaign đã kết thúc từ lâu.

Phát hiện khi khảo sát: `frontend-admin/src/lib/errorCodes.ts` đã có sẵn 5 error code cho
Collection (`COLLECTION_DELETE_BLOCKED_RUNNING`, `COLLECTION_START_DATE_IN_PAST`,
`COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING`, `COLLECTION_UPDATE_BLOCKED_ENDED`,
`COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED`) và 2 code liên quan phía Product
(`PRODUCT_NOT_IN_COLLECTION`, `PRODUCT_COLLECTION_ENDED`) kèm message tiếng Việt hoàn
chỉnh, nhưng BE hoàn toàn chưa dùng tới — lần thứ 3 gặp mẫu hình "FE code trước, BE chưa
nối dây" trong dự án này (sau `CATEGORY_NAME_DUPLICATE` và `includeDeleted`). Thiết kế này
dựa trực tiếp vào các code có sẵn đó (coi như bản thiết kế gốc do người trước để lại) +
thực tế nghiệp vụ để lấp đầy phần logic còn thiếu.

`Order`/`OrderItem` không tham chiếu `Collection` (không có `collectionId` ở đâu trong
schema đơn hàng) — nên xóa Collection không có rủi ro làm hỏng lịch sử đơn hàng.
`CollectionProduct` có `onDelete: Cascade` từ cả 2 phía (`Collection` và `Product`) — xóa 1
trong 2 chỉ tự động gỡ dòng liên kết, không ảnh hưởng bản ghi còn lại.

## Quyết định thiết kế (đã chốt với user)

1. **Xóa Product**: không thêm chặn ở BE (giữ nguyên cascade hiện có, admin tự chịu trách
   nhiệm) — chỉ thêm cảnh báo ở FE trước khi xác nhận xóa nếu sản phẩm đang thuộc 1+
   Collection.
2. **Gỡ sản phẩm khỏi Collection đã ENDED**: chặn giống hệt "gán" — coi ENDED là trạng thái
   đóng băng hoàn toàn, danh sách sản phẩm từng thuộc 1 campaign đã kết thúc không được sửa
   nữa (nhất quán với việc `update()` khóa toàn bộ field khi ENDED).
3. **Xóa Collection đã ENDED**: cho xóa (khớp đúng bộ code FE có sẵn — chỉ có
   `COLLECTION_DELETE_BLOCKED_RUNNING`, không có code chặn xóa khi ENDED; không có bảng nào
   khác tham chiếu `collectionId` nên an toàn về dữ liệu).
4. **Sửa `startDate` khi UPCOMING**: chặn ngày quá khứ giống hệt lúc tạo mới, dùng chung 1
   hàm check + code `COLLECTION_START_DATE_IN_PAST`, chỉ áp khi `startDate` thực sự đổi.

## Bổ sung phát hiện thêm trong lúc rà code (không phải quyết định mới, chỉ là áp đúng rule
đã chốt vào đủ chỗ)

`products.service.ts` có **2 nơi** tạo liên kết Product→Collection, cùng dùng chung helper
`assertCollectionsExist()`: `create()` (tạo sản phẩm kèm sẵn `collectionIds`) và
`assignCollections()` (endpoint gán riêng). Rule "chặn gán vào Collection đã ENDED" phải áp
vào đúng helper dùng chung này để không bị sót nhánh `create()`. `UpdateProductDto` cố ý
loại bỏ `collectionIds` (comment sẵn trong DTO) nên `update()` sản phẩm không cần đụng tới.

## Thay đổi Backend (`backend-cms`)

### `src/common/constants/error-codes.ts`
Thêm các code còn thiếu (giữ nguyên `CATEGORY_NAME_DUPLICATE` đã có):
```ts
COLLECTION_DELETE_BLOCKED_RUNNING: 1101,
COLLECTION_START_DATE_IN_PAST: 1102,
COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING: 1103,
COLLECTION_UPDATE_BLOCKED_ENDED: 1104,
COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED: 1105,
PRODUCT_COLLECTION_ENDED: 1212,
```
(Giá trị số khớp chính xác với `frontend-admin/src/lib/errorCodes.ts` — bắt buộc, 2 file
này không share type được, sai số sẽ làm FE hiện sai message hoặc rơi về fallback.)

### `src/modules/collections/collections.service.ts`
- `create()`: thêm `assertStartDateNotInPast(dto.startDate)` trước khi tạo.
- `update()`: tính `status` của bản ghi hiện tại (`withStatus(existing).status`) ngay sau
  khi load `existing`, rồi:
  - `RUNNING`: nếu `dto.name !== undefined && dto.name !== existing.name`, hoặc
    `dto.startDate !== undefined` và ngày khác `existing.startDate` → ném
    `COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING`.
  - `ENDED`: nếu **bất kỳ** field nào trong `dto` được gửi và khác giá trị hiện tại (so
    từng field: name, startDate, endDate, banner, description) → ném
    `COLLECTION_UPDATE_BLOCKED_ENDED`.
  - `UPCOMING`: nếu `dto.startDate` đổi → `assertStartDateNotInPast(dto.startDate)`.
- `remove()`: nếu `withStatus(existing).status === RUNNING` → ném
  `COLLECTION_DELETE_BLOCKED_RUNNING`.
- `assignProducts()`: nếu `withStatus(existing).status === ENDED` → ném
  `COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED` (áp dụng cho cả trường hợp `productIds` rỗng —
  tức "gỡ hết" cũng bị chặn khi ENDED, đúng quyết định 2).
- `removeProduct()`: fetch Collection trước, nếu ENDED → ném lỗi (dùng
  `BadRequestException` message thường, KHÔNG kèm `code` — FE chưa có code dựng sẵn riêng
  cho case "gỡ 1 sản phẩm", fallback đọc message thô vẫn hiển thị đúng qua
  `getErrorMessage()`).
- Helper mới `assertStartDateNotInPast(startDate: string)`: so theo ngày lịch (dùng lại
  kiểu `toDateOnly()` đã có) — hôm nay vẫn hợp lệ, chỉ chặn ngày < hôm nay.

### `src/modules/products/products.service.ts`
- `assertCollectionsExist(collectionIds)`: đổi từ chỉ đếm số lượng sang fetch đủ
  `startDate`/`endDate`, vừa giữ check tồn tại (đủ số lượng) vừa thêm check không có
  collection nào đang `ENDED` trong danh sách → ném `PRODUCT_COLLECTION_ENDED` nếu có. Áp
  dụng tự động cho cả `create()` và `assignCollections()` (dùng chung helper).
- `removeFromCollection()`: fetch Collection trước, nếu ENDED → ném lỗi (message thường,
  không kèm code — cùng lý do như `removeProduct()` phía Collection).

## Thay đổi Frontend (`frontend-admin`)

- `src/pages/products/ProductList.tsx`: trong `ConfirmModal` xóa sản phẩm, nếu
  `deleteTarget.collections.length > 0` → thêm dòng cảnh báo liệt kê tên các bộ sưu tập sẽ
  bị gỡ (dữ liệu `collections: {id, name, slug}[]` đã có sẵn trong response `GET /products`,
  không cần gọi thêm API).
- Không cần sửa gì khác — `errorCodes.ts`/`ERROR_CODE_MESSAGE` đã có sẵn đầy đủ message cho
  các code Collection dùng lần này, `CollectionForm`/`AssignProductsModal` đã dùng
  `toast.error(getErrorMessage(error))` theo đúng pattern chung, tự động hiển thị đúng khi
  BE trả `code`.

## Testing

- BE: verify thủ công qua curl (tạo collection ngày quá khứ, sửa tên/ngày khi RUNNING, sửa
  bất kỳ field khi ENDED, xóa khi RUNNING vs ENDED, gán/gỡ sản phẩm khi ENDED cả 2 chiều,
  tạo sản phẩm kèm `collectionIds` trỏ tới collection đã ENDED) + `lint`/`build`.
- FE: verify thủ công trên `pnpm dev` (xóa sản phẩm đang thuộc collection → thấy cảnh báo)
  + `lint`/`build`.
