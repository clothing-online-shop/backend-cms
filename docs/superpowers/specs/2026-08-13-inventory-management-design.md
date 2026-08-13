# Thiết kế: Quản lý tồn kho theo biến thể (Sprint 2, Tuần 2 — B. Quản lý kho)

## 1. Bối cảnh & phạm vi

Nguồn gốc: dòng công việc "B. Quản lý kho" trong bảng kế hoạch Sprint 2 — 5 hạng mục (3 BE, 2 FE-Admin):

1. API tồn kho theo biến thể + nhập kho (cộng dồn, ghi nhận người nhập & thời gian) — BE
2. API xuất kho / điều chỉnh tồn kho (bắt buộc ghi lý do) + nhật ký lịch sử nhập-xuất-điều chỉnh — BE
3. Cảnh báo hết hàng / sắp hết hàng khi tồn biến thể ≤ ngưỡng cấu hình (VD ≤ 5) — BE
4. Màn tồn kho theo biến thể: bảng sản phẩm-size-màu, tìm kiếm/lọc, highlight hàng sắp hết — FE-Admin
5. Màn nhập kho / điều chỉnh tồn + màn lịch sử nhập-xuất-điều chỉnh kho — FE-Admin

### Hiện trạng trước khi làm (đã khảo sát code)

- `StockMovement` **đã có sẵn** trong `prisma/schema.prisma` (model + enum `StockMovementType { IMPORT EXPORT ADJUSTMENT RETURN }`) nhưng **chưa được dùng ở bất kỳ đâu** trong `src/` — coi như đã có sẵn chỗ để cắm vào, không cần đổi schema cho phần này.
- `ProductVariant.stockQuantity` hiện chỉ được set 2 chỗ: (a) lúc tạo/sửa sản phẩm (số tồn khởi tạo, qua `syncVariants`), (b) `PATCH /products/:id/variants/:variantId/stock` (`updateVariantStock`) — ghi đè tuyệt đối, không log, không lý do.
- Endpoint `PATCH .../stock` **không được FE nào gọi** trong UI hiện tại (chỉ định nghĩa ở `hooks/useProducts.ts`, không trang nào import) — coi là dead code có thể thay thế.
- `orders` module **chưa hề đụng tới `stockQuantity`** — chưa có logic tự trừ kho khi tạo đơn. Việc tích hợp trừ kho tự động theo đơn hàng KHÔNG nằm trong sprint này.
- Trang "Cấu hình" (`Settings.tsx`) hiện là placeholder rỗng, chưa có backend config nào.

### Trong phạm vi

- Xem tồn kho theo biến thể: bảng phẳng, tìm kiếm/lọc, highlight sắp hết/hết hàng.
- Nhập kho (cộng dồn).
- Xuất kho (trừ, bắt buộc lý do) và Điều chỉnh theo kiểm kê (nhập số tồn thực tế mới, bắt buộc lý do).
- Lịch sử toàn bộ giao dịch kho: trang riêng, lọc theo sản phẩm/biến thể/loại giao dịch/khoảng ngày.
- Ngưỡng cảnh báo sắp hết hàng: 1 số cấu hình chung toàn hệ thống, admin sửa được trong trang Cấu hình.

### Ngoài phạm vi (sprint sau)

- Loại giao dịch `RETURN` (trả hàng) — đã có sẵn trong enum nhưng KHÔNG expose ở UI/API sprint này, để dành khi làm luồng đổi/trả hàng gắn với đơn hàng.
- Tự động trừ kho khi tạo đơn hàng / hoàn kho khi hủy đơn.
- Ngưỡng cảnh báo riêng theo từng sản phẩm/biến thể (chỉ làm ngưỡng chung).
- Vai trò nhân sự riêng cho kho (chỉ dùng role `ADMIN` sẵn có).

### Dọn dẹp kèm theo

Bỏ `PATCH /products/:id/variants/:variantId/stock`, `UpdateStockDto`, `updateVariantStock()` (service + controller), và hàm `updateVariantStock()`/hook liên quan ở FE (`lib/api/products-api.ts`, `hooks/useProducts.ts`) — thay hoàn toàn bằng 2 endpoint nhập/xuất-điều chỉnh mới của module `inventory`, để **mọi** thay đổi `stockQuantity` sau khi tạo sản phẩm đều đi qua `StockMovement` và có lịch sử. Số tồn khởi tạo lúc tạo/sửa sản phẩm (`syncVariants`) giữ nguyên như hiện tại — đây là "số dư ban đầu", không phải một giao dịch kho cần audit.

## 2. Data model (Prisma)

`StockMovement` giữ nguyên, không đổi. Thêm mới:

```prisma
model SystemConfig {
  key   String @id
  value String

  @@map("system_configs")
}
```

Bảng key-value đơn giản. Sprint này chỉ dùng 1 row: `key: "lowStockThreshold"`, `value: "5"` (string, parse `Int` ở service). Chọn key-value thay vì bảng `InventorySettings` riêng vì trang "Cấu hình" sẽ cần thêm config khác ở các sprint sau — có sẵn nền dùng chung thay vì mỗi lần thêm 1 bảng mới.

## 3. Backend — module mới `inventory`

Theo quy tắc "1 module = 1 domain" (CLAUDE.md backend) — tách khỏi `products` vì đây là nghiệp vụ riêng (vận hành tồn kho), dù thao tác trực tiếp trên `ProductVariant`.

```
src/modules/inventory/
├── inventory.module.ts        # imports PrismaModule; không cần import ProductsModule/CollectionsModule
├── inventory.controller.ts
├── inventory.service.ts
└── dto/
    ├── list-inventory.dto.ts
    ├── import-stock.dto.ts
    ├── adjust-stock.dto.ts
    ├── list-stock-history.dto.ts
    └── update-inventory-settings.dto.ts
```

### Endpoints

| Method | Path | Mô tả |
|---|---|---|
| GET | `/inventory` | Bảng tồn kho theo biến thể — join `Product` + `ProductVariant`, filter `search` (tên SP/SKU), `categoryId`, `brandId`, `lowStockOnly` (boolean), phân trang (`page`/`limit` theo convention hiện có) |
| GET | `/inventory/settings` | Đọc `lowStockThreshold` hiện tại |
| PUT | `/inventory/settings` | Sửa `lowStockThreshold` — chỉ `ADMIN` |
| POST | `/inventory/variants/:variantId/import` | Nhập kho |
| POST | `/inventory/variants/:variantId/adjust` | Xuất kho / Điều chỉnh (2 loại chung 1 endpoint, khác field bắt buộc theo `type`) |
| GET | `/inventory/history` | Lịch sử giao dịch — filter `variantId`, `productId`, `type`, `from`, `to`; phân trang; join tên sản phẩm/biến thể (size, màu, SKU) + `createdBy.fullName` |

### `POST /inventory/variants/:variantId/import`

```ts
class ImportStockDto {
  @IsInt() @Min(1) quantity: number;   // > 0, cộng dồn vào stockQuantity hiện tại
  @IsOptional() @IsString() note?: string;
}
```
Ghi `StockMovement { type: IMPORT, quantity: +dto.quantity, note, createdById: currentUser.id }`, `productVariant.update({ stockQuantity: { increment: dto.quantity } })` — trong `$transaction`.

### `POST /inventory/variants/:variantId/adjust`

```ts
class AdjustStockDto {
  @IsEnum(['EXPORT', 'ADJUSTMENT']) type: 'EXPORT' | 'ADJUSTMENT';
  @ValidateIf(o => o.type === 'EXPORT') @IsInt() @Min(1) quantity?: number;       // số lượng xuất
  @ValidateIf(o => o.type === 'ADJUSTMENT') @IsInt() @Min(0) actualQuantity?: number; // số tồn thực tế đếm được
  @IsString() @IsNotEmpty() reason: string;  // bắt buộc cho cả 2 loại
}
```

- `type: EXPORT`: tồn mới = tồn hiện tại − `quantity`. Nếu < 0 → `BadRequestException` (`code: INVENTORY_EXPORT_EXCEEDS_STOCK`). Ghi `StockMovement { type: EXPORT, quantity: -dto.quantity, note: dto.reason }`.
- `type: ADJUSTMENT`: delta = `actualQuantity` − tồn hiện tại. Nếu delta === 0 → `BadRequestException` (`code: INVENTORY_ADJUSTMENT_NO_CHANGE`, "Số tồn thực tế trùng với hệ thống, không có gì để điều chỉnh."). Ghi `StockMovement { type: ADJUSTMENT, quantity: delta, note: dto.reason }`.
- Cả 2 nhánh update `productVariant.stockQuantity` trong cùng `$transaction` với việc tạo `StockMovement`.

### Validate & lỗi chung

- Tất cả field số lượng `@IsInt() @Min(...)` — không cho số âm/thập phân lọt qua validate tầng DTO.
- `code` lỗi forward qua `AllExceptionsFilter` sẵn có (đúng pattern `ErrorCode` đã dùng ở Category/Collection) — thêm các key mới vào `src/common/constants/error-codes.ts`.
- Ghi/sửa (`import`, `adjust`, `PUT /settings`) chỉ `ADMIN` (`@Roles(UserRole.ADMIN)` + `RolesGuard`, khớp convention hiện có). `GET` các loại chỉ cần `JwtAuthGuard`.

## 4. Frontend

### Routes & sidebar

- `/inventory` — mục sidebar **"Tồn kho"**, tách riêng ngang hàng "Sản phẩm"/"Danh mục"/"Bộ sưu tập" (đúng cách sidebar hiện tại tổ chức — mỗi domain 1 mục cấp cao nhất, chưa có submenu lồng nhau ở đâu).
- `/inventory/history` — trang con, breadcrumb `Tồn kho > Lịch sử`.

### `InventoryList.tsx` (`pages/inventory/`)

- `DataTable<InventoryVariantRow>` — bảng phẳng, 1 dòng = 1 biến thể (khớp pattern `ProductList`/`BrandList`, không nhóm theo sản phẩm — đơn giản hơn, filter/phân trang hoạt động tự nhiên, tránh phải tự viết component expand/collapse mới).
- Cột: Ảnh, Sản phẩm, Size, Màu, SKU, Tồn kho (badge đỏ "Hết hàng" nếu `=0`, vàng "Sắp hết" nếu `<= lowStockThreshold`, mặc định nếu còn nhiều), Thao tác (1 nút "Nhập/Điều chỉnh" mở `StockMovementModal`).
- Thanh filter tái dùng `ProductFilterBar` (search/category/brand) + thêm 1 `Checkbox`/`Switch` "Chỉ hiện sắp hết hàng".

### `StockMovementModal.tsx` (`pages/inventory/`)

- 1 modal duy nhất cho 1 biến thể, 3 tab **Nhập kho / Xuất kho / Điều chỉnh** (mặc định mở tab Nhập kho — thao tác phổ biến nhất).
- Tab Nhập kho: field "Số lượng nhập" + "Ghi chú" (tuỳ chọn).
- Tab Xuất kho: field "Số lượng xuất" + "Lý do" (bắt buộc).
- Tab Điều chỉnh: field "Số tồn thực tế" (mặc định điền sẵn tồn hiện tại) + "Lý do" (bắt buộc) — hiện thêm dòng preview "Chênh lệch: {delta}" tính client-side để admin thấy trước khi lưu.
- Submit gọi đúng 1 trong 2 mutation (`useImportStock` / `useAdjustStock`) theo tab đang chọn — dùng React Hook Form + Yup như quy ước, schema riêng theo từng tab hoặc 1 schema union theo `type`.

### `InventoryHistory.tsx` (`pages/inventory/`)

- `DataTable<StockMovementRow>` — cột Thời gian, Sản phẩm/Biến thể (size+màu+SKU), Loại giao dịch (badge màu theo loại), Số lượng thay đổi (hiện dấu +/-), Lý do/Ghi chú, Người thực hiện.
- Filter: search theo tên SP/SKU, `Select` loại giao dịch, khoảng ngày bằng 2 `DatePicker` (from/to) — chưa có component `DateRangePicker` sẵn trong codebase, không tự chế thêm component mới cho việc này.

### `Settings.tsx`

- Thay nội dung placeholder hiện tại bằng 1 field "Ngưỡng cảnh báo tồn kho sắp hết" (số nguyên, `useUpdateInventorySettings` mutation), giữ khung trang hiện có để sprint sau thêm config khác vào cùng trang.

### Types & API layer

- `types/inventory-api.types.ts`: `ImportStockPayload`, `AdjustStockPayload`, `ListInventoryParams`, `ListStockHistoryParams`.
- `types/shared-types.ts`: thêm `InventoryVariantRow`, `StockMovement`, `StockMovementType` (response shape).
- `lib/api/inventory-api.ts`, `hooks/useInventory.ts` — theo đúng pattern `products-api.ts`/`useProducts.ts`.

## 5. Testing

- BE: unit test cho `inventory.service.ts` — case cộng dồn nhập kho đúng số; xuất kho vượt tồn bị chặn; điều chỉnh delta=0 bị chặn; điều chỉnh tăng/giảm tính đúng delta; transaction rollback nếu 1 trong 2 write lỗi (mock Prisma throw giữa chừng).
- FE: verify thủ công theo `pnpm dev` — luồng nhập/xuất/điều chỉnh 1 biến thể thật, kiểm tra badge sắp hết/hết hàng đổi đúng theo threshold, trang lịch sử lọc đúng.
- Không thuộc 3 module bắt buộc unit+e2e (Auth/Orders/Payments theo CLAUDE.md) nên không bắt buộc e2e, nhưng nên có unit test cho phần tính toán số lượng (dễ sai off-by-one/sai dấu).
