# Flash Sale — Thêm sản phẩm khi đang RUNNING (Design)

## Bối cảnh

Tính năng Flash Sale (backend-cms + frontend-admin) đã build xong, review sạch, verify Playwright
thật — hiện đang nằm trên nhánh `feature/flash-sale` ở cả 2 repo, **chưa merge/push**. Đây là bổ
sung cho cùng tính năng đang phát triển đó, không phải tính năng độc lập, nên tiếp tục code thẳng
lên 2 nhánh `feature/flash-sale` hiện có (không tạo nhánh mới).

Luật sửa hiện tại (`FlashSalesService.update()`, backend-cms): khi status = RUNNING, chỉ được sửa
`endDate` — mọi thay đổi `name`/`startDate`/`items` đều bị chặn cứng (`ConflictException`,
`FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING`). Yêu cầu mới: cho phép **thêm** sản phẩm/biến thể vào
1 đợt đang RUNNING, nhưng **không** cho xóa hoặc sửa sản phẩm đã có từ trước.

## Vì sao không tái dùng thẳng `update()`'s items-branch hiện có

`update()`'s items-branch (dùng khi UPCOMING) xử lý theo kiểu **thay thế toàn bộ**: xóa hết
`FlashSaleItem` cũ rồi tạo lại từ mảng `items` gửi lên, trong 1 `$transaction`. Nếu chỉ ẩn nút
"Xóa" ở FE mà vẫn dùng chung cơ chế này, một request API trực tiếp (Postman, client lỗi...) vẫn
xóa được item cũ vì backend không thật sự chặn — "không cho xóa" phải là luật được **backend
enforce**, không phải chỉ ẩn ở giao diện. Vì vậy tách hẳn 1 endpoint mới, chỉ làm đúng 1 việc:
INSERT thêm dòng mới, không đụng gì tới dòng cũ.

## API mới

### `POST /flash-sales/:id/items`

- **Roles:** `ADMIN`, `MARKETING` — giống các endpoint ghi khác của Flash Sale.
- **Body:** `{ items: FlashSaleItemInputDto[] }` — dùng lại nguyên `FlashSaleItemInputDto` đã có
  (`productVariantId`, `salePrice`, `quantityLimit`), không tạo DTO mới.
- **Response:** `FlashSaleDetail` đầy đủ (giống `create`/`update`/`endNow` — FE không cần đoán
  shape mới).
- **Guard trạng thái:** chỉ chạy khi status hiện tại (suy runtime qua
  `deriveInstantRangeStatus()`) là RUNNING. Nếu UPCOMING hoặc ENDED → `ConflictException` với mã
  mới `FLASH_SALE_ADD_ITEMS_NOT_RUNNING` (xem Error codes bên dưới). UPCOMING vẫn dùng cơ chế
  PATCH thay thế toàn bộ items như hiện tại — endpoint này **không** áp dụng cho UPCOMING (không
  mở rộng phạm vi ngoài đúng nhu cầu đang giải quyết).
- **Validate item mới:** tái dùng nguyên `validateFlashSaleItems()` đã có — salePrice phải nhỏ
  hơn giá gốc hiện tại của biến thể, quantityLimit không vượt tồn kho hiện tại, dedupe trùng
  `productVariantId` trong payload, và `assertNoVariantOverlap()` (biến thể không được trùng với
  campaign khác đang hoạt động có khung giờ giao nhau — kể cả không được trùng với chính item cũ
  **của campaign này**, vì `assertNoVariantOverlap()` không loại trừ chính campaign đang thao tác
  trong trường hợp này — xem chi tiết ở mục "Không được thêm trùng biến thể đã có sẵn" bên dưới).
- **Không giới hạn** số lần gọi hay số lượng sản phẩm thêm vào — miễn qua được validate.
- **Không chặn theo thời gian còn lại** — vẫn cho thêm ngay cả khi campaign sắp hết giờ, miễn
  còn đang RUNNING tại thời điểm request tới.
- **Ghi dữ liệu:** `INSERT` thêm các `FlashSaleItem` mới (mỗi item `soldCount` mặc định `0` như
  lúc tạo mới bình thường — không có gì đặc biệt). Không xóa, không cập nhật bất kỳ
  `FlashSaleItem` nào đã tồn tại trước đó — về mặt kỹ thuật, hàm mới **không** có bước
  `deleteMany` nào cả, khác hẳn `update()`'s items-branch.
- **Không đổi `FlashSale.startDate`/`endDate`/`name`** — endpoint này chỉ thêm item, không đụng
  gì tới thông tin chung của campaign.

### Không được thêm trùng biến thể đã có sẵn (kể cả của chính campaign này)

`assertNoVariantOverlap()` hiện tại nhận tham số `excludeFlashSaleId` để loại trừ CHÍNH campaign
đang sửa khỏi việc tự-so-với-chính-mình (dùng khi UPCOMING sửa lại toàn bộ items — vì lúc đó item
cũ sẽ bị xóa hết trước khi tạo lại, nên không có ý nghĩa tự chặn chính nó). Ở endpoint MỚI này,
item cũ **không bị xóa**, nên nếu admin cố thêm lại đúng 1 biến thể đã có sẵn trong campaign, đây
là hành vi cần chặn (tránh trùng lặp — `@@unique([flashSaleId, productVariantId])` ở DB sẽ tự ném
lỗi P2002 nếu không chặn sớm, gây lỗi 500 khó hiểu). Vì vậy khi gọi
`validateFlashSaleItems()`/`assertNoVariantOverlap()` từ endpoint mới, **không truyền**
`excludeFlashSaleId` (truyền `null`) — để overlap-check tự nhiên bắt luôn cả trường hợp trùng với
chính campaign này.

## Error codes mới

Thêm vào `src/common/constants/error-codes/flash-sale.ts` (cả backend-cms lẫn map tương ứng ở
frontend-admin `src/lib/errorCodes/flash-sale.ts` — phải khớp số chính xác giữa 2 repo, tiếp nối
dải 2201-2213 hiện có):

```
FLASH_SALE_ADD_ITEMS_NOT_RUNNING: 2214
```

Message: "Chỉ có thể thêm sản phẩm vào đợt Flash Sale đang diễn ra."

## Frontend

### Hiện lại nút "Thêm sản phẩm" khi RUNNING

`FlashSaleForm.tsx` hiện đang dùng `lockCoreFields = viewOnly || isRunning || isEnded` để khoá
TOÀN BỘ khối "Sản phẩm tham gia" (ẩn nút Thêm, ẩn nút Xóa từng dòng) khi RUNNING. Cần tách riêng:

- **Item CŨ** (đã hydrate từ API lúc mở form, tức đã tồn tại trong DB) — vẫn khoá cứng: input
  salePrice/quantityLimit disabled, không hiện nút Xóa. Giữ nguyên hành vi hiện tại cho các dòng
  này.
- **Item MỚI** (vừa chọn qua picker trong phiên sửa hiện tại, chưa lưu) — vẫn sửa/xóa được bình
  thường như lúc UPCOMING (input không disabled, có nút Xóa) cho tới khi bấm Lưu.
- Nút "Thêm sản phẩm" hiện lại khi RUNNING (không còn ẩn theo `lockCoreFields` cho riêng phần
  này) — picker vẫn loại trừ đúng mọi biến thể đã có mặt trong campaign (cũ + mới chọn), dùng lại
  nguyên `excludeVariantIds` hiện có (tính từ toàn bộ `fields` hiện tại, không cần đổi gì).

Cách phân biệt item cũ/mới trong code: chụp lại tập `productVariantId` đã hydrate lúc `reset()`
(gọi là `hydratedVariantIds`, 1 `Set` tính 1 lần lúc `flashSale` load xong) — 1 dòng trong
`fields` là "item cũ" nếu `hydratedVariantIds.has(field.productVariantId)`, ngược lại là "item
mới". `name`/`startDate` vẫn khoá hoàn toàn như hiện tại khi RUNNING (không đổi).

### Luồng lưu (1 nút "Lưu" duy nhất)

Khi RUNNING và bấm "Lưu":

1. Tính `newItems` = các dòng trong `fields` mà `productVariantId` KHÔNG nằm trong
   `hydratedVariantIds`.
2. Nếu `newItems.length > 0` → gọi `POST /flash-sales/:id/items` với `newItems` (map về đúng
   shape `{productVariantId, salePrice, quantityLimit}`, giống cách `onValid()` hiện đang map
   `values.items` trước khi gửi).
   - Lỗi ở bước này → dừng lại, toast lỗi qua `getErrorMessage()`, **không** gọi bước 3 (chưa đổi
     `endDate`).
3. Nếu `endDate` đã đổi so với giá trị hydrate ban đầu → gọi `PATCH /flash-sales/:id` với
   `{ endDate }` (giữ nguyên logic `isRunning ? { endDate: payload.endDate } : payload` đã có).
   - Lỗi ở bước này (SAU KHI bước 2 đã thành công) → toast báo rõ: "Đã thêm sản phẩm nhưng chưa
     cập nhật được ngày kết thúc, vui lòng thử lại." — không rollback bước 2 (dữ liệu vẫn hợp lệ,
     admin thử lại việc đổi `endDate` sau).
4. Nếu không có `newItems` và `endDate` không đổi → không gọi API nào thêm ngoài validate
   thông thường (trường hợp hiếm — nút Lưu chỉ bấm được khi có thay đổi thật, giữ nguyên hành vi
   `isValid`/`isDirty` hiện có, không cần xử lý đặc biệt).
5. Nếu KHÔNG RUNNING (UPCOMING/ENDED/tạo mới) → giữ nguyên hoàn toàn luồng hiện tại, không đổi
   gì (chỉ nhánh RUNNING mới có logic 2-bước này).

### Hook mới

`useAddFlashSaleItems()` (React Query mutation, `hooks/useFlashSales.ts`) — gọi `POST
/flash-sales/:id/items`, invalidate đúng `FLASH_SALES_KEY` giống các mutation khác trong file.

## Ngoài phạm vi (không làm ở lần này)

- Không cho sửa `salePrice`/`quantityLimit` của item CŨ khi RUNNING (đóng băng hoàn toàn).
- Không giới hạn số lần/số lượng thêm.
- Không chặn thêm khi gần hết giờ.
- Không mở rộng endpoint mới cho UPCOMING (UPCOMING giữ nguyên cơ chế PATCH thay thế toàn bộ).
- Không đụng gì tới `soldCount`/luồng checkout thật (vẫn ngoài phạm vi dự án như toàn bộ tính
  năng Flash Sale từ đầu).
