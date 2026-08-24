# Flash Sale — quản lý đợt sale nhanh (backend-cms + frontend-admin)

**Ngày:** 2026-08-24
**Repo liên quan:** backend-cms (schema + API), frontend-admin (UI quản trị)
**Ngoài phạm vi:** backend-user, frontend-website — mọi phần "áp dụng flash sale thật lúc
khách mua hàng" (giá hiển thị trên storefront, trừ `soldCount` lúc checkout...) để trống,
làm ở đợt sau. Đợt này chỉ có CRUD quản lý ở CMS.

## Mục tiêu

Cho phép Admin/Marketing tạo 1 đợt Flash Sale gồm nhiều sản phẩm/biến thể dùng chung 1 khung
giờ, mỗi biến thể có giá sale + giới hạn số lượng riêng, sửa/kết thúc sớm được, và tự suy ra
trạng thái đang diễn ra/sắp diễn ra/đã kết thúc — theo đúng pattern đã có của Collection/
Banner trong codebase.

## 1. Data model (Prisma — backend-cms sở hữu duy nhất)

```prisma
model FlashSale {
  id        String   @id @default(cuid())
  name      String
  startDate DateTime
  endDate   DateTime
  isDelete  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  items FlashSaleItem[]

  @@map("flash_sales")
}

model FlashSaleItem {
  id               String   @id @default(cuid())
  flashSaleId      String
  productVariantId String
  // Giá bán trong đợt sale — số tiền tuyệt đối, không phải %. Phải nhỏ hơn
  // ProductVariant.price hiện tại tại thời điểm thêm vào (validate ở service).
  salePrice        Decimal  @db.Decimal(12, 2)
  // Số lượng tối đa được bán với giá sale — phải <= ProductVariant.stockQuantity hiện tại
  // tại thời điểm thêm vào (không thể sale nhiều hơn tồn kho thật).
  quantityLimit    Int
  // Số đã bán trong đợt sale — mặc định 0, ĐỢT NÀY CMS tự chỉnh tay qua API riêng, CHƯA nối
  // với luồng tạo đơn thật (backend-user, làm sau). isSoldOut suy ra runtime:
  // soldCount >= quantityLimit, không lưu cột riêng.
  soldCount        Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  flashSale      FlashSale      @relation(fields: [flashSaleId], references: [id], onDelete: Cascade)
  productVariant ProductVariant @relation(fields: [productVariantId], references: [id], onDelete: Restrict)

  @@unique([flashSaleId, productVariantId])
  @@index([flashSaleId])
  @@index([productVariantId])
  @@map("flash_sale_items")
}
```

`ProductVariant` thêm quan hệ ngược `flashSaleItems FlashSaleItem[]` (không có field mới trên
chính `ProductVariant`).

Status **không lưu cột riêng** — suy ra bằng `deriveDateRangeStatus(startDate, endDate)` đã có
sẵn trong `common/utils/date.util.ts` (dùng chung với Collection/Banner), trả về đúng type
`DateRangeStatus` ('UPCOMING' | 'RUNNING' | 'ENDED') đã tồn tại — không thêm enum mới.

## 2. Luật nghiệp vụ

### 2.1. Validate khi tạo/sửa item

- `salePrice < productVariant.price` (giá gốc hiện tại) — nếu không, từ chối rõ ràng.
- `quantityLimit <= productVariant.stockQuantity` (tồn kho hiện tại) — không cho sale nhiều
  hơn tồn kho thật.
- `quantityLimit > 0`.
- **Chặn trùng biến thể giữa các đợt sale còn hiệu lực**: 1 `productVariantId` không được
  xuất hiện ở 2 `FlashSale` khác nhau có khung thời gian **giao nhau** (`existing.startDate <=
  new.endDate AND existing.endDate >= new.startDate`) và đợt kia **chưa ENDED**
  (`existing.endDate >= now()`). Áp dụng cho cả tạo mới lẫn sửa (loại trừ chính campaign đang
  sửa). Lý do: tránh xung đột "giá nào thắng" nếu 2 đợt sale cùng áp cho 1 sản phẩm cùng lúc.

### 2.2. Luật sửa theo trạng thái (mirror Collection, có mở rộng cho `soldCount`)

| Trạng thái | Được sửa |
|---|---|
| UPCOMING | Tự do: tên, `startDate`, `endDate`, toàn bộ danh sách item (thêm/xóa/đổi giá/đổi giới hạn) — `items` trong `PATCH` là **thay thế toàn bộ** (xóa hết item cũ, tạo lại theo danh sách mới, giống `assignProducts()` của Collection), không phải merge/diff. Vì đang UPCOMING nên mọi item lúc này `soldCount` luôn = 0, thay thế toàn bộ không làm mất dữ liệu thật nào. |
| RUNNING | **Chỉ** `endDate` (kết thúc sớm = set về hiện tại, hoặc gia hạn = đẩy xa hơn) — khóa tên/`startDate`/danh sách item để không đổi điều khoản đang chạy |
| ENDED | Khóa hoàn toàn |

`soldCount` của từng item: sửa được **bất kỳ lúc nào** qua endpoint riêng, không phụ thuộc
trạng thái campaign — đây là điều chỉnh sổ sách (đợt này chưa có gì tự động ghi nhận), không
phải đổi điều khoản sale.

### 2.3. Xóa

Chỉ xóa mềm (`isDelete = true`) khi trạng thái **không phải RUNNING** — giống hệt rule
`CollectionsService.remove()`. Xóa hẳn `FlashSaleItem` con trong cùng transaction (không cần
giữ lại vì không có gì tham chiếu ngược).

### 2.4. Phân quyền

- Xem (list + detail): `ADMIN_PANEL_ROLES` (ADMIN, WAREHOUSE_STAFF, MARKETING).
- Tạo/sửa/xóa/kết thúc sớm/chỉnh `soldCount`: `ADMIN`, `MARKETING` — giống hệt Voucher.

## 3. API (backend-cms)

```
GET    /flash-sales
  Query: search (tên), status (UPCOMING|RUNNING|ENDED), page, limit
  → { data: FlashSaleWithStatus[], meta: PageMeta }
  (status suy ra ở tầng ứng dụng như Voucher/Collection → lọc status xong mới cắt trang thủ
  công trên mảng đã lọc, không dùng buildSkipTake/Prisma skip-take)

GET    /flash-sales/:id
  → FlashSaleWithStatus (kèm items[], mỗi item kèm product { id, name, slug, thumbnail } +
    variant { size, color, sku, price } + isSoldOut suy ra runtime)

POST   /flash-sales
  Body: { name, startDate, endDate, items: [{ productVariantId, salePrice, quantityLimit }] }
  (items bắt buộc >= 1 dòng — tạo campaign kèm toàn bộ item ngay trong 1 request, giống
  ProductForm tạo sản phẩm kèm variants)

PATCH  /flash-sales/:id
  Body: Partial<{ name, startDate, endDate, items }> — áp luật theo status ở mục 2.2

PATCH  /flash-sales/:id/end-now
  Không body — set endDate = new Date()

PATCH  /flash-sales/:id/items/:itemId/sold-count
  Body: { soldCount: number }  (0 <= soldCount <= quantityLimit của item đó)

DELETE /flash-sales/:id
  Xóa mềm, 409 nếu đang RUNNING
```

### Error code

Range mới **2201-2299** (tiếp theo Voucher 2101-2199, đúng quy ước mỗi domain giữ 1 range
100 số trong `common/constants/error-codes/index.ts`). Các mã dự kiến: `FLASH_SALE_NOT_FOUND`,
`FLASH_SALE_INVALID_SALE_PRICE` (>= giá gốc), `FLASH_SALE_QUANTITY_EXCEEDS_STOCK`,
`FLASH_SALE_VARIANT_OVERLAP`, `FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING`,
`FLASH_SALE_UPDATE_BLOCKED_ENDED`, `FLASH_SALE_DELETE_BLOCKED_RUNNING`,
`FLASH_SALE_ITEM_NOT_FOUND`, `FLASH_SALE_SOLD_COUNT_EXCEEDS_LIMIT`.

## 4. Frontend-admin

### 4.1. `pages/flash-sales/FlashSaleList.tsx`

DataTable: tên, thời gian (bắt đầu–kết thúc), trạng thái (Badge, map qua
`lib/flashSaleStatus.ts` theo đúng pattern `collectionStatus.ts`), số sản phẩm tham gia, thao
tác (xem/sửa/xóa). Filter: ô tìm theo tên (debounce 500ms) + dropdown trạng thái. Phân trang
bắt buộc: `page`/`limit` state + `Pagination` (kèm `onPageSizeChange` — "Số dòng/trang", đúng
pattern vừa chuẩn hóa lại ở toàn bộ các màn danh sách khác trong session này).

### 4.2. `pages/flash-sales/FlashSaleForm.tsx`

Trang riêng (không phải Modal — cần khu chọn sản phẩm khá lớn, giống `VoucherForm.tsx` hơn
`CollectionFormModal.tsx`), dùng 1 component cho 3 route: `/flash-sales/new`,
`/flash-sales/:id/edit`, `/flash-sales/:id` (`viewOnly`).

- Card "Thông tin đợt sale": tên, ngày bắt đầu/kết thúc (`DatePicker` có sẵn, `minDate="today"`
  lúc tạo mới — theo đúng fix vừa làm cho Voucher).
- Card "Sản phẩm tham gia":
  - Ô tìm kiếm sản phẩm (theo tên/SKU) → danh sách kết quả dạng dropdown/gợi ý (ảnh nhỏ, tên,
    size/màu, giá gốc, tồn kho hiện tại) → bấm chọn 1 biến thể để thêm vào bảng bên dưới.
  - Bảng các item đã chọn: ảnh, tên SP, size/màu, giá gốc (chỉ đọc), ô nhập `salePrice`
    (`CurrencyInput` có sẵn), ô nhập `quantityLimit` (số nguyên dương), nút xóa dòng. Khi
    RUNNING: toàn bộ khu này readonly (theo luật 2.2).
- Nút "Kết thúc sớm" (chỉ hiện khi RUNNING) → `ConfirmModal` → gọi `end-now`.
- Ở màn sửa (RUNNING): mỗi dòng item có thêm ô nhỏ chỉnh `soldCount` tay (luôn sửa được, tách
  biệt khỏi trạng thái khóa của các field khác).

### 4.3. Hỗ trợ khác

- `types/flash-sales-api.types.ts`, `lib/api/flash-sales-api.ts`, `hooks/useFlashSales.ts` —
  theo đúng cấu trúc 4 lớp (api/hook/type/page) đang dùng cho mọi feature khác.
- `schemas/flash-sale.schema.ts` — Yup: `name` required, `startDate` required (không cho chọn
  quá khứ), `endDate` required + sau `startDate`, `items` `min(1, "Chọn ít nhất 1 sản phẩm.")`,
  mỗi item `salePrice`/`quantityLimit` required + dương.
- Thêm menu "Flash Sale" vào `AdminLayout.tsx` sidebar + route trong `routes/index.tsx`.

## 5. Test

- Backend: unit test cho `FlashSalesService` — luật sửa theo status (UPCOMING/RUNNING/ENDED),
  chặn trùng biến thể (overlap thời gian, cả tạo lẫn sửa), validate `salePrice`/`quantityLimit`
  so với giá gốc/tồn kho, chặn xóa khi RUNNING, cắt trang đúng sau khi lọc status (giống pattern
  `vouchers.service.spec.ts`/`collections.service.spec.ts` đã có).
- Frontend: verify bằng Playwright thật trên trình duyệt sau khi code xong (luồng tạo → sửa
  UPCOMING → kết thúc sớm 1 đợt RUNNING → xác nhận khóa field đúng lúc RUNNING → xóa 1 đợt
  UPCOMING) — theo đúng quy trình đã áp dụng xuyên suốt session.

## Ngoài phạm vi (rõ ràng, không làm ở đợt này)

- backend-user: không có endpoint/logic nào đọc `FlashSaleItem` để hiển thị giá sale hay áp
  dụng lúc tạo đơn. `soldCount` không tự tăng khi khách mua hàng thật.
- frontend-website: không có UI hiển thị flash sale cho khách.
- Không có cơ chế thông báo/countdown/banner quảng bá flash sale trên storefront.
- Không giới hạn số lượng mua/khách cho từng item (khác với Voucher có `perCustomerLimit`) —
  không có yêu cầu này, không tự thêm.
