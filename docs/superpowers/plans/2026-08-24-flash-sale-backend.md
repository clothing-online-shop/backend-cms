# Flash Sale — Backend (backend-cms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây API CRUD Flash Sale ở backend-cms — 1 campaign (FlashSale) chứa nhiều
FlashSaleItem (mỗi item = 1 ProductVariant + giá sale + giới hạn số lượng), status suy ra
theo thời gian, luật sửa/xóa/kết thúc sớm theo trạng thái.

**Architecture:** Module `src/modules/flash-sales/` theo đúng khuôn NestJS 4 file
(module/controller/service/dto) đã dùng cho Voucher/Collection. Status không lưu cột riêng —
suy ra runtime bằng `deriveDateRangeStatus()` có sẵn. `soldCount` có trong schema nhưng chỉ
CMS tự chỉnh tay ở đợt này (không nối checkout thật — ngoài phạm vi).

**Tech Stack:** NestJS, Prisma, PostgreSQL, class-validator, Jest.

## Global Constraints

- 1 module = 1 domain dưới `src/modules/<ten>/` (module.ts, controller.ts, service.ts, dto/).
- Mọi DTO field có `@ApiProperty()`/`@ApiPropertyOptional()`.
- Ném `HttpException` chuẩn Nest kèm `code` lỗi rõ ràng (không tự format response tay).
- Đổi Prisma schema → chạy `npx prisma migrate dev --name <mô tả>`, không sửa tay migration cũ.
- Helper dùng ≥ 2 module → đặt vào `common/utils/`, không copy-paste.
- Phân trang: status suy ra ở tầng ứng dụng (không phải cột DB) → lọc xong mới cắt trang thủ
  công trên mảng đã lọc (dùng `buildPageMeta()`, KHÔNG dùng `buildSkipTake()`/Prisma
  skip-take) — đúng pattern `VouchersService.findAll()`/`CollectionsService.findAll()`.
- Error code range mới cho Flash Sale: **2201-2299** (Voucher đang giữ 2101-2199).
- Trước khi chạy `prisma migrate dev` trên Windows: PHẢI tắt hẳn dev server đang chạy (khoá
  file `query_engine-windows.dll.node`, gây `EPERM` nếu chưa tắt) — dùng
  `Get-NetTCPConnection -LocalPort 3002 -State Listen | Select-Object -ExpandProperty OwningProcess`
  rồi `Stop-Process -Force`. Nếu vẫn báo lock, kiểm tra toàn bộ tiến trình node còn sót:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "backend-cms" }`
  và tắt hết trước khi thử lại.
- Trước khi bắt đầu: `git checkout -b feature/flash-sale fix-develop` — **nhánh này đã có sẵn
  từ trước** (rẽ từ `fix-develop` local, không phải `origin/fix-develop`, tránh lỗi gán nhầm
  upstream), spec design đã commit ở đó (`b9ebd4b`). Chỉ cần `git checkout feature/flash-sale`
  nếu chưa đứng đúng nhánh, không cần tạo lại.

---

### Task 1: Prisma schema — thêm model FlashSale + FlashSaleItem

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: model `FlashSale { id, name, startDate, endDate, isDelete, createdAt, updatedAt, items: FlashSaleItem[] }`, model `FlashSaleItem { id, flashSaleId, productVariantId, salePrice: Decimal, quantityLimit: Int, soldCount: Int, createdAt, updatedAt, flashSale, productVariant }`.

- [ ] **Step 1: Thêm 2 model vào cuối `prisma/schema.prisma`** (sau model `Banner`, trước
  `model BlogPost` — hoặc bất kỳ vị trí hợp lý nào giữa các model, miễn nằm trong file)

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
  // Giá bán trong đợt sale — số tiền tuyệt đối, phải nhỏ hơn ProductVariant.price hiện tại
  // tại thời điểm thêm vào (validate ở service, không phải ràng buộc DB).
  salePrice        Decimal  @db.Decimal(12, 2)
  // Số lượng tối đa bán với giá sale — phải <= ProductVariant.stockQuantity hiện tại tại
  // thời điểm thêm vào (validate ở service).
  quantityLimit    Int
  // Số đã bán trong đợt sale — CMS tự chỉnh tay ở giai đoạn này, CHƯA nối với luồng tạo đơn
  // thật (backend-user, làm sau — xem docs/superpowers/specs/2026-08-24-flash-sale-design.md
  // mục "Ngoài phạm vi"). isSoldOut suy ra runtime (soldCount >= quantityLimit), không lưu cột.
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

- [ ] **Step 2: Thêm quan hệ ngược trên `ProductVariant`**

Trong `model ProductVariant` (tìm dòng `stockMovements StockMovement[]`), thêm ngay dưới:

```prisma
  flashSaleItems FlashSaleItem[]
```

- [ ] **Step 3: Tắt dev server nếu đang chạy** (xem Global Constraints), sau đó chạy migration

```bash
npx prisma migrate dev --name add_flash_sale
```

Expected: tạo thư mục migration mới trong `prisma/migrations/`, generate lại Prisma Client
thành công, không có lỗi EPERM.

- [ ] **Step 4: Xác nhận Prisma Client đã có type mới**

```bash
grep -n "FlashSale" node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/index.d.ts | head -5
```

Expected: thấy `FlashSale`, `FlashSaleItem` xuất hiện trong output (khẳng định generate đã
chạy đúng).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(flash-sales): thêm model FlashSale + FlashSaleItem"
```

---

### Task 2: Tách `isDateInPast()` dùng chung, áp lại cho Collection

**Files:**
- Modify: `src/common/utils/date.util.ts`
- Modify: `src/modules/collections/collections.service.ts:389-396` (hàm `assertStartDateNotInPast` ở cuối file)
- Test: `src/common/utils/date.util.spec.ts`

**Interfaces:**
- Produces: `isDateInPast(date: string): boolean` — export từ `date.util.ts`.
- Consumes (Task 6 sau này): Flash Sale tự viết `assertStartDateNotInPast` RIÊNG (dùng mã lỗi
  Flash Sale) gọi `isDateInPast()` này — không tái dùng thẳng hàm assert của Collection (khác
  mã lỗi giữa 2 domain).

Lý do tách: hiện `assertStartDateNotInPast` trong `collections.service.ts` đang tự hardcode
`ErrorCode.COLLECTION_START_DATE_IN_PAST` ngay trong hàm — không tái dùng thẳng được cho Flash
Sale (khác mã lỗi). Theo đúng CLAUDE.md ("helper dùng ≥ 2 module → viết vào common/utils"),
tách phần SO SÁNH NGÀY thuần túy (không ném lỗi) ra dùng chung, còn phần "ném lỗi kèm mã nào"
để nguyên ở từng service tự quyết theo domain riêng.

- [ ] **Step 1: Thêm hàm `isDateInPast()` vào `date.util.ts`**

Thêm vào cuối file `src/common/utils/date.util.ts`:

```typescript
// Dùng chung cho mọi nơi cần chặn chọn ngày bắt đầu trong quá khứ (Collection, Flash Sale...)
// — so theo NGÀY LỊCH (bỏ qua giờ, cùng cách toDateOnly() đang dùng cho deriveDateRangeStatus)
// để admin chọn "hôm nay" vẫn hợp lệ dù giờ hiện tại đã qua nửa đêm giờ server. Trả boolean
// thuần, KHÔNG ném lỗi — mỗi domain tự quyết định ném lỗi gì/mã nào (xem
// assertStartDateNotInPast() ở collections.service.ts và flash-sales.service.ts).
export function isDateInPast(date: string): boolean {
  return toDateOnly(new Date(date)) < toDateOnly(new Date());
}
```

- [ ] **Step 2: Viết test cho `isDateInPast()`**

Thêm vào `src/common/utils/date.util.spec.ts`:

```typescript
import { isDateInPast } from './date.util';

describe('isDateInPast', () => {
  it('ngày trong quá khứ (hôm qua) → true', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isDateInPast(yesterday.toISOString())).toBe(true);
  });

  it('hôm nay → false (so theo ngày lịch, không phải giờ chính xác)', () => {
    expect(isDateInPast(new Date().toISOString())).toBe(false);
  });

  it('ngày trong tương lai → false', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isDateInPast(tomorrow.toISOString())).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận pass**

```bash
pnpm --filter @clothing-shop/be test -- date.util.spec
```

Expected: PASS toàn bộ (test cũ trong file + 3 test mới).

- [ ] **Step 4: Sửa `collections.service.ts` dùng lại hàm chung**

Trong `src/modules/collections/collections.service.ts`, sửa import (đầu file, dòng có
`toDateOnly`):

```typescript
import {
  deriveDateRangeStatus,
  assertDateRange,
  toDateOnly,
  isDateInPast,
} from '../../common/utils/date.util';
```

Sửa hàm `assertStartDateNotInPast` ở cuối file (dòng 389-396):

```typescript
function assertStartDateNotInPast(startDate: string): void {
  if (isDateInPast(startDate)) {
    throw new ConflictException({
      message: 'Ngày bắt đầu không được ở trong quá khứ.',
      code: ErrorCode.COLLECTION_START_DATE_IN_PAST,
    });
  }
}
```

(Nếu sau bước sửa `toDateOnly` không còn được dùng trực tiếp ở đâu khác trong file, xóa khỏi
import — kiểm tra bằng `grep -n "toDateOnly" src/modules/collections/collections.service.ts`
trước khi xóa.)

- [ ] **Step 5: Chạy lại toàn bộ test Collection, xác nhận không vỡ gì**

```bash
pnpm --filter @clothing-shop/be test -- collections.service.spec
```

Expected: PASS toàn bộ (hành vi không đổi, chỉ đổi cách implement bên trong).

- [ ] **Step 6: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: 0 lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/common/utils/date.util.ts src/common/utils/date.util.spec.ts src/modules/collections/collections.service.ts
git commit -m "refactor: tách isDateInPast() dùng chung, áp lại cho Collection"
```

---

### Task 3: Mở rộng `InventoryService.findAll()` trả thêm giá gốc (price)

**Files:**
- Modify: `src/modules/inventory/inventory.service.ts:88-102`

**Interfaces:**
- Produces: `InventoryService.findAll()` response mỗi dòng thêm field `price: number` (giá gốc
  hiện tại của variant — `ProductVariant.price.toNumber()`).
- Consumes (frontend-admin plan, Task 5): FE dùng lại nguyên `GET /inventory` (đã có sẵn, tìm
  theo tên/SKU, phân trang) làm API tìm-và-chọn biến thể cho khu "Sản phẩm tham gia" của form
  Flash Sale — không viết endpoint tìm kiếm mới trùng lặp logic.

Lý do: `GET /inventory` đã có sẵn đúng thứ cần cho picker chọn sản phẩm/biến thể (tìm theo
tên/SKU, trả về `variantId/sku/size/color/stockQuantity/productName/thumbnail`, có phân
trang) — chỉ thiếu `price` (giá gốc) để FE hiện + validate `salePrice < price` ngay lúc chọn.
Thêm field, không viết lại toàn bộ query.

- [ ] **Step 1: Sửa response mapping trong `findAll()`**

Trong `src/modules/inventory/inventory.service.ts`, sửa khối `return { data: variants.map(...) }`
(dòng 88-102):

```typescript
    return {
      data: variants.map((variant) => ({
        variantId: variant.id,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        price: variant.price.toNumber(),
        stockQuantity: variant.stockQuantity,
        lowStockThreshold: threshold,
        productId: variant.product.id,
        productName: variant.product.name,
        productSlug: variant.product.slug,
        thumbnail: variant.product.thumbnail,
      })),
      meta: buildPageMeta(total, page, limit),
    };
```

(chỉ thêm đúng 1 dòng `price: variant.price.toNumber(),` — `variant.price` đã có sẵn trong dữ
liệu Prisma trả về, không cần sửa gì ở `include`/`select` phía trên.)

- [ ] **Step 2: Kiểm tra test Inventory hiện có còn pass**

```bash
pnpm --filter @clothing-shop/be test -- inventory.service.spec
```

Expected: PASS. Nếu có test assert `toEqual()` so khớp CHÍNH XÁC shape response (không dùng
`objectContaining`), test đó sẽ FAIL vì thiếu field `price` mới — nếu vậy, thêm `price` vào
đúng object mong đợi trong test đó (giá trị theo đúng fixture `price` đã khai trong test, gọi
`.toNumber()` nếu là `Prisma.Decimal`).

- [ ] **Step 3: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/inventory/inventory.service.ts
git commit -m "feat(inventory): trả thêm giá gốc (price) ở GET /inventory — dùng cho picker Flash Sale"
```

---

### Task 4: Error codes cho Flash Sale

**Files:**
- Create: `src/common/constants/error-codes/flash-sale.ts`
- Modify: `src/common/constants/error-codes/index.ts`

**Interfaces:**
- Produces: `ErrorCode.FLASH_SALE_NOT_FOUND` (2201), `FLASH_SALE_VARIANT_NOT_FOUND` (2202),
  `FLASH_SALE_INVALID_SALE_PRICE` (2203), `FLASH_SALE_QUANTITY_EXCEEDS_STOCK` (2204),
  `FLASH_SALE_VARIANT_OVERLAP` (2205), `FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING` (2206),
  `FLASH_SALE_UPDATE_BLOCKED_ENDED` (2207), `FLASH_SALE_DELETE_BLOCKED_RUNNING` (2208),
  `FLASH_SALE_ITEM_NOT_FOUND` (2209), `FLASH_SALE_SOLD_COUNT_EXCEEDS_LIMIT` (2210),
  `FLASH_SALE_END_NOW_NOT_RUNNING` (2211), `FLASH_SALE_START_DATE_IN_PAST` (2212).

- [ ] **Step 1: Tạo file `src/common/constants/error-codes/flash-sale.ts`**

```typescript
export const FlashSaleErrorCode = {
  FLASH_SALE_NOT_FOUND: 2201,
  FLASH_SALE_VARIANT_NOT_FOUND: 2202,
  FLASH_SALE_INVALID_SALE_PRICE: 2203,
  FLASH_SALE_QUANTITY_EXCEEDS_STOCK: 2204,
  FLASH_SALE_VARIANT_OVERLAP: 2205,
  FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING: 2206,
  FLASH_SALE_UPDATE_BLOCKED_ENDED: 2207,
  FLASH_SALE_DELETE_BLOCKED_RUNNING: 2208,
  FLASH_SALE_ITEM_NOT_FOUND: 2209,
  FLASH_SALE_SOLD_COUNT_EXCEEDS_LIMIT: 2210,
  FLASH_SALE_END_NOW_NOT_RUNNING: 2211,
  FLASH_SALE_START_DATE_IN_PAST: 2212,
} as const;
```

- [ ] **Step 2: Đăng ký vào `index.ts`**

Trong `src/common/constants/error-codes/index.ts`, thêm import (cạnh `VoucherErrorCode`):

```typescript
import { FlashSaleErrorCode } from './flash-sale';
```

Thêm vào object `ErrorCode` (cạnh `...VoucherErrorCode,`):

```typescript
  ...FlashSaleErrorCode,
```

Sửa dòng comment range (dòng ghi `// Voucher 2101-2199`) thêm dòng mới ngay dưới:

```
// Flash Sale 2201-2299
```

- [ ] **Step 3: Build để xác nhận không đụng số trùng nhau**

```bash
pnpm --filter @clothing-shop/be build
```

Expected: build qua (TypeScript sẽ không tự phát hiện trùng SỐ giữa các domain vì chỉ là
number literal, nhưng object spread `{...A, ...B}` nếu trùng KEY sẽ bị TypeScript cảnh báo
type — trùng SỐ khác KEY thì không lỗi build, tự kiểm tra bằng mắt so với dải số 2101-2199
của Voucher đã dùng, đảm bảo không cấp lại đúng số nào).

- [ ] **Step 4: Commit**

```bash
git add src/common/constants/error-codes/flash-sale.ts src/common/constants/error-codes/index.ts
git commit -m "feat(flash-sales): thêm error code range 2201-2299"
```

---

### Task 5: DTOs

**Files:**
- Create: `src/modules/flash-sales/dto/flash-sale-item-input.dto.ts`
- Create: `src/modules/flash-sales/dto/create-flash-sale.dto.ts`
- Create: `src/modules/flash-sales/dto/update-flash-sale.dto.ts`
- Create: `src/modules/flash-sales/dto/list-flash-sales-query.dto.ts`
- Create: `src/modules/flash-sales/dto/update-sold-count.dto.ts`

**Interfaces:**
- Produces: `FlashSaleItemInputDto { productVariantId: string; salePrice: number; quantityLimit: number }`,
  `CreateFlashSaleDto { name: string; startDate: string; endDate: string; items: FlashSaleItemInputDto[] }`,
  `UpdateFlashSaleDto { name?: string; startDate?: string; endDate?: string; items?: FlashSaleItemInputDto[] }`,
  `ListFlashSalesQueryDto { search?: string; status?: DateRangeStatus; page?: number; limit?: number }`,
  `UpdateSoldCountDto { soldCount: number }`.
- Consumes (Task 6-8): Service/Controller import trực tiếp các DTO này.

- [ ] **Step 1: `dto/flash-sale-item-input.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, IsString } from 'class-validator';

export class FlashSaleItemInputDto {
  @ApiProperty({ description: 'Id biến thể sản phẩm (ProductVariant)' })
  @IsString()
  productVariantId!: string;

  @ApiProperty({ description: 'Giá bán trong đợt sale — phải nhỏ hơn giá gốc hiện tại' })
  @IsNumber()
  @IsPositive()
  salePrice!: number;

  @ApiProperty({ description: 'Số lượng tối đa bán với giá sale — phải <= tồn kho hiện tại' })
  @IsInt()
  @IsPositive()
  quantityLimit!: number;
}
```

- [ ] **Step 2: `dto/create-flash-sale.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FlashSaleItemInputDto } from './flash-sale-item-input.dto';

export class CreateFlashSaleDto {
  @ApiProperty({ example: 'Flash Sale 12.12' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '2026-12-12T00:00:00.000Z' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-12-12T02:00:00.000Z' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({
    type: [FlashSaleItemInputDto],
    description: 'Danh sách sản phẩm/biến thể tham gia — ít nhất 1 dòng',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlashSaleItemInputDto)
  items!: FlashSaleItemInputDto[];
}
```

- [ ] **Step 3: `dto/update-flash-sale.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FlashSaleItemInputDto } from './flash-sale-item-input.dto';

export class UpdateFlashSaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    type: [FlashSaleItemInputDto],
    description:
      'Thay thế TOÀN BỘ danh sách item hiện có (không phải merge) — chỉ áp dụng được khi đợt sale đang UPCOMING',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlashSaleItemInputDto)
  items?: FlashSaleItemInputDto[];
}
```

- [ ] **Step 4: `dto/list-flash-sales-query.dto.ts`**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { DateRangeStatus } from '../../../common/utils/date.util';

// DateRangeStatus là union string thuần (không phải Prisma enum thật) — dùng @IsIn với mảng
// hằng số thay vì @IsEnum (chỉ nhận enum/object thật).
const DATE_RANGE_STATUSES = ['UPCOMING', 'RUNNING', 'ENDED'] as const;

export class ListFlashSalesQueryDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên (contains, không phân biệt hoa thường)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: DATE_RANGE_STATUSES })
  @IsOptional()
  @IsIn(DATE_RANGE_STATUSES)
  status?: DateRangeStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
```

- [ ] **Step 5: `dto/update-sold-count.dto.ts`**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateSoldCountDto {
  @ApiProperty({ description: 'Số đã bán mới — phải <= quantityLimit của item đó' })
  @IsInt()
  @Min(0)
  soldCount!: number;
}
```

- [ ] **Step 6: Build để xác nhận DTO compile sạch**

```bash
pnpm --filter @clothing-shop/be build
```

Expected: lỗi "Cannot find module './flash-sales.service'" hoặc tương tự KHÔNG xảy ra vì DTO
không import service — build phải qua sạch ở bước này (DTO là file độc lập).

- [ ] **Step 7: Commit**

```bash
git add src/modules/flash-sales/dto
git commit -m "feat(flash-sales): thêm DTO cho create/update/list/sold-count"
```

---

### Task 6: `FlashSalesService` — đọc dữ liệu (findAll, findOne)

**Files:**
- Create: `src/modules/flash-sales/flash-sales.service.ts`
- Test: `src/modules/flash-sales/flash-sales.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (inject qua constructor), `deriveDateRangeStatus`, `buildPageMeta`
  (đã có sẵn), `ErrorCode.FLASH_SALE_NOT_FOUND`.
- Produces: `FlashSalesService.findAll(query: ListFlashSalesQueryDto): Promise<{ data: FlashSaleListItem[]; meta: PageMeta }>`,
  `FlashSalesService.findOne(id: string): Promise<FlashSaleDetail>`, type `FlashSaleListItem`,
  type `FlashSaleDetail`, type `FlashSaleItemDetail` (export cả 3 type — Task 7/8 dùng lại).
  Private `findExisting(id): Promise<FlashSale>` — Task 7 cũng cần gọi lại hàm này.

Đây là task đầu tiên tạo file service — bắt đầu bằng khung tối thiểu (constructor + 2 hàm đọc)
để có thể viết test ngay, các hàm ghi (create/update/...) thêm ở Task 7-8 vào CÙNG file này.

- [ ] **Step 1: Viết test cho `findAll()` (mặc định page/limit + phân trang + filter status)**

Tạo `src/modules/flash-sales/flash-sales.service.spec.ts`:

```typescript
import { FlashSalesService } from './flash-sales.service';
import { PrismaService } from '../../config/prisma.service';

function createMocks() {
  const findMany = jest.fn();
  const prisma = {
    flashSale: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
}

// startDate xa quá khứ + endDate xa tương lai -> luôn RUNNING (deriveDateRangeStatus).
function runningFlashSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `fs-${Math.random()}`,
    name: 'Flash Sale',
    startDate: new Date('2020-01-01'),
    endDate: new Date('2099-01-01'),
    isDelete: false,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    items: [],
    ...overrides,
  };
}

function endedFlashSale(overrides: Partial<Record<string, unknown>> = {}) {
  return runningFlashSale({
    startDate: new Date('2020-01-01'),
    endDate: new Date('2020-06-01'),
    ...overrides,
  });
}

describe('FlashSalesService.findAll', () => {
  it('không truyền page/limit -> mặc định page=1 limit=20', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningFlashSale({ id: 'fs1' }),
      runningFlashSale({ id: 'fs2' }),
    ]);
    const service = new FlashSalesService(prisma);

    const result = await service.findAll({});

    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
  });

  it('phân trang cắt đúng phần tử theo page/limit', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => runningFlashSale({ id: `fs${i + 1}` })),
    );
    const service = new FlashSalesService(prisma);

    const page2 = await service.findAll({ page: 2, limit: 2 });

    expect(page2.data.map((fs) => fs.id)).toEqual(['fs3', 'fs4']);
    expect(page2.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  it('filter status=ENDED lọc xong mới phân trang -> total khớp đúng kết quả đã lọc', async () => {
    const { prisma, findMany } = createMocks();
    findMany.mockResolvedValue([
      runningFlashSale({ id: 'running-1' }),
      endedFlashSale({ id: 'ended-1' }),
      endedFlashSale({ id: 'ended-2' }),
    ]);
    const service = new FlashSalesService(prisma);

    const result = await service.findAll({ status: 'ENDED', page: 1, limit: 20 });

    expect(result.data.map((fs) => fs.id).sort()).toEqual(['ended-1', 'ended-2']);
    expect(result.meta.total).toBe(2);
  });
});

describe('FlashSalesService.findOne', () => {
  function createDetailMocks() {
    const findUnique = jest.fn();
    const prisma = { flashSale: { findUnique } } as unknown as PrismaService;
    return { prisma, findUnique };
  }

  it('không tìm thấy -> NotFoundException kèm code 2201', async () => {
    const { prisma, findUnique } = createDetailMocks();
    findUnique.mockResolvedValue(null);
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.findOne('missing');
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2201 });
  });

  it('đã bị xóa mềm (isDelete=true) -> coi như không tìm thấy', async () => {
    const { prisma, findUnique } = createDetailMocks();
    findUnique.mockResolvedValue({ ...runningFlashSale(), isDelete: true, items: [] });
    const service = new FlashSalesService(prisma);

    await expect(service.findOne('fs-deleted')).rejects.toMatchObject({
      status: 404,
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** (chưa có `flash-sales.service.ts`)

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: FAIL với lỗi "Cannot find module './flash-sales.service'".

- [ ] **Step 3: Viết `flash-sales.service.ts` (khung + 2 hàm đọc)**

Tạo `src/modules/flash-sales/flash-sales.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { FlashSale, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import {
  deriveDateRangeStatus,
  type DateRangeStatus,
} from '../../common/utils/date.util';
import { buildPageMeta, type PageMeta } from '../../common/utils/pagination.util';
import { ErrorCode } from '../../common/constants/error-codes';
import { ListFlashSalesQueryDto } from './dto/list-flash-sales-query.dto';

export type FlashSaleListItem = FlashSale & {
  status: DateRangeStatus;
  itemCount: number;
};

export type FlashSaleItemDetail = {
  id: string;
  productVariantId: string;
  salePrice: number;
  quantityLimit: number;
  soldCount: number;
  isSoldOut: boolean;
  product: { id: string; name: string; slug: string; thumbnail: string | null };
  // stockQuantity đi kèm để FE dùng làm mốc validate lại quantityLimit khi sửa (input FE
  // hiện "tối đa X" cạnh field, tránh phải đợi submit rồi mới biết bị chặn ở BE).
  variant: { size: string; color: string; sku: string; price: number; stockQuantity: number };
};

export type FlashSaleDetail = FlashSale & {
  status: DateRangeStatus;
  items: FlashSaleItemDetail[];
};

const DETAIL_INCLUDE = {
  items: {
    include: {
      productVariant: {
        include: {
          product: { select: { id: true, name: true, slug: true, thumbnail: true } },
        },
      },
    },
  },
} satisfies Prisma.FlashSaleInclude;

@Injectable()
export class FlashSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListFlashSalesQueryDto,
  ): Promise<{ data: FlashSaleListItem[]; meta: PageMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.FlashSaleWhereInput = { isDelete: false };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const flashSales = await this.prisma.flashSale.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: { items: true },
    });

    const withStatuses: FlashSaleListItem[] = flashSales.map((fs) => ({
      ...fs,
      status: deriveDateRangeStatus(fs.startDate, fs.endDate),
      itemCount: fs.items.length,
    }));
    // status là field suy ra (không nằm trong DB) nên lọc ở đây, sau khi map, thay vì đưa
    // vào Prisma where() phía trên — cùng lý do/pattern VouchersService.findAll().
    const filtered = query.status
      ? withStatuses.filter((fs) => fs.status === query.status)
      : withStatuses;

    const start = (page - 1) * limit;
    return {
      data: filtered.slice(start, start + limit),
      meta: buildPageMeta(filtered.length, page, limit),
    };
  }

  async findOne(id: string): Promise<FlashSaleDetail> {
    const flashSale = await this.prisma.flashSale.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!flashSale || flashSale.isDelete) {
      throw new NotFoundException({
        message: 'Không tìm thấy đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_NOT_FOUND,
      });
    }
    return toDetail(flashSale);
  }

  // Dùng lại ở Task 7-8 (update/endNow/remove/updateSoldCount) — trả về bản ghi FlashSale
  // TRẦN (không kèm items), đủ để đọc startDate/endDate/isDelete quyết định luật sửa/xóa.
  private async findExisting(id: string): Promise<FlashSale> {
    const flashSale = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!flashSale || flashSale.isDelete) {
      throw new NotFoundException({
        message: 'Không tìm thấy đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_NOT_FOUND,
      });
    }
    return flashSale;
  }
}

type FlashSaleWithDetailInclude = Prisma.FlashSaleGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toDetail(flashSale: FlashSaleWithDetailInclude): FlashSaleDetail {
  return {
    ...flashSale,
    status: deriveDateRangeStatus(flashSale.startDate, flashSale.endDate),
    items: flashSale.items.map((item) => ({
      id: item.id,
      productVariantId: item.productVariantId,
      salePrice: item.salePrice.toNumber(),
      quantityLimit: item.quantityLimit,
      soldCount: item.soldCount,
      isSoldOut: item.soldCount >= item.quantityLimit,
      product: {
        id: item.productVariant.product.id,
        name: item.productVariant.product.name,
        slug: item.productVariant.product.slug,
        thumbnail: item.productVariant.product.thumbnail,
      },
      variant: {
        size: item.productVariant.size,
        color: item.productVariant.color,
        sku: item.productVariant.sku,
        price: item.productVariant.price.toNumber(),
        stockQuantity: item.productVariant.stockQuantity,
      },
    })),
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: PASS toàn bộ (5 test).

- [ ] **Step 5: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: có thể có cảnh báo `noUnusedLocals` cho `findExisting` (private, chưa được gọi ở
đâu trong task này) — bỏ qua tạm, Task 7 sẽ dùng tới. Nếu build lỗi thật (không phải warning)
vì lý do này, thêm tạm `// eslint-disable-next-line` không cần thiết — TypeScript
`noUnusedLocals` KHÔNG áp dụng cho private method chưa dùng trong class (chỉ áp dụng biến/
tham số cấp module), nên thực tế sẽ không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/modules/flash-sales/flash-sales.service.ts src/modules/flash-sales/flash-sales.service.spec.ts
git commit -m "feat(flash-sales): FlashSalesService.findAll/findOne"
```

---

### Task 7: `FlashSalesService` — validate item (giá/tồn kho/trùng biến thể)

**Files:**
- Modify: `src/modules/flash-sales/flash-sales.service.ts`
- Test: `src/modules/flash-sales/flash-sales.service.spec.ts`

**Interfaces:**
- Consumes: `FlashSaleItemInputDto` (Task 5), `findExisting()` (private, Task 6).
- Produces: private `validateAndPrepareItems(items: FlashSaleItemInputDto[], startDate: Date, endDate: Date, excludeFlashSaleId: string | null): Promise<{ productVariantId: string; salePrice: Prisma.Decimal; quantityLimit: number }[]>`
  — Task 8 (`create`/`update`) gọi hàm này trước khi ghi DB.

Đây là phần logic phức tạp nhất của cả tính năng — validate giá/tồn kho từng dòng, VÀ chặn 1
biến thể tham gia nhiều đợt sale trùng thời gian. Tách riêng 1 task để review kỹ ở đây trước
khi Task 8 ghép vào `create`/`update`.

- [ ] **Step 1: Viết test cho `validateAndPrepareItems()` — vì đây là hàm `private`, test
  qua đường vòng bằng cách gọi `create()` (sẽ viết ở Task 8) là hợp lý hơn, NHƯNG để giữ đúng
  nguyên tắc TDD (viết test trước implementation), tạm thời đổi hàm này thành có thể gọi được
  từ test bằng cách export riêng 1 hàm module-level `validateFlashSaleItems` (không phải
  method của class) — nhận thêm `prisma` làm tham số đầu, dễ test độc lập, cũng dễ tái sử dụng
  hơn is a method riêng phải khởi tạo cả service.**

Thêm vào cuối `src/modules/flash-sales/flash-sales.service.spec.ts` (sau
`describe('FlashSalesService.findOne', ...)`):

```typescript
import { Prisma } from '@prisma/client';
import { validateFlashSaleItems } from './flash-sales.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

function variant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? 'variant-1',
    price: new Prisma.Decimal((overrides.price as number) ?? 200000),
    stockQuantity: (overrides.stockQuantity as number) ?? 10,
    sku: (overrides.sku as string) ?? 'SKU-1',
  };
}

describe('validateFlashSaleItems', () => {
  function createValidationMocks() {
    const variantFindMany = jest.fn();
    const itemFindMany = jest.fn();
    const prisma = {
      productVariant: { findMany: variantFindMany },
      flashSaleItem: { findMany: itemFindMany },
    };
    return { prisma, variantFindMany, itemFindMany };
  }

  const NEW_START = new Date('2026-09-01T00:00:00.000Z');
  const NEW_END = new Date('2026-09-02T00:00:00.000Z');

  it('hợp lệ -> trả về đúng danh sách item đã chuẩn hóa (salePrice là Decimal)', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1', price: 200000, stockQuantity: 10 })]);
    itemFindMany.mockResolvedValue([]);

    const result = await validateFlashSaleItems(
      prisma as never,
      [{ productVariantId: 'variant-1', salePrice: 150000, quantityLimit: 5 }],
      NEW_START,
      NEW_END,
      null,
    );

    expect(result).toEqual([
      { productVariantId: 'variant-1', salePrice: new Prisma.Decimal(150000), quantityLimit: 5 },
    ]);
  });

  it('salePrice >= giá gốc -> BadRequestException kèm code 2203', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1', price: 100000 })]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-1', salePrice: 100000, quantityLimit: 1 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ code: 2203 });
  });

  it('quantityLimit > tồn kho -> BadRequestException kèm code 2204', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1', stockQuantity: 3 })]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 4 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2204 });
  });

  it('biến thể trùng với đợt sale khác còn hiệu lực, khung giờ giao nhau -> ConflictException kèm code 2205', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    itemFindMany.mockResolvedValue([
      {
        productVariantId: 'variant-1',
        flashSaleId: 'other-flash-sale',
        flashSale: { name: 'Đợt sale khác' },
        productVariant: { sku: 'SKU-1' },
      },
    ]);

    let caught: ConflictException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
  });

  it('đang sửa 1 flash sale (excludeFlashSaleId) -> tự loại trừ chính nó khỏi check trùng', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);

    await validateFlashSaleItems(
      prisma as never,
      [{ productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 }],
      NEW_START,
      NEW_END,
      'this-flash-sale-id',
    );

    expect(itemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          flashSaleId: { not: 'this-flash-sale-id' },
        }) as unknown,
      }),
    );
  });

  it('biến thể không tồn tại -> BadRequestException kèm code 2202', async () => {
    const { prisma, variantFindMany, itemFindMany } = createValidationMocks();
    variantFindMany.mockResolvedValue([]);
    itemFindMany.mockResolvedValue([]);

    let caught: BadRequestException | undefined;
    try {
      await validateFlashSaleItems(
        prisma as never,
        [{ productVariantId: 'variant-missing', salePrice: 1000, quantityLimit: 1 }],
        NEW_START,
        NEW_END,
        null,
      );
    } catch (err) {
      caught = err as BadRequestException;
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2202 });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** (chưa export `validateFlashSaleItems`)

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: FAIL — `validateFlashSaleItems is not a function` hoặc lỗi import tương tự (các
test đọc/findAll/findOne ở Task 6 vẫn PASS).

- [ ] **Step 3: Viết hàm `validateFlashSaleItems` — thêm vào CUỐI `flash-sales.service.ts`**
  (bên ngoài class, cùng file, giống cách `computeDiscount()` là hàm module-level ở
  `vouchers.service.ts`)

```typescript
export async function validateFlashSaleItems(
  prisma: Pick<Prisma.TransactionClient, 'productVariant' | 'flashSaleItem'>,
  items: FlashSaleItemInputDto[],
  startDate: Date,
  endDate: Date,
  excludeFlashSaleId: string | null,
): Promise<{ productVariantId: string; salePrice: Prisma.Decimal; quantityLimit: number }[]> {
  const variantIds = items.map((item) => item.productVariantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const item of items) {
    const variant = variantById.get(item.productVariantId);
    if (!variant) {
      throw new BadRequestException({
        message: 'Không tìm thấy biến thể sản phẩm.',
        code: ErrorCode.FLASH_SALE_VARIANT_NOT_FOUND,
      });
    }
    if (item.salePrice >= variant.price.toNumber()) {
      throw new BadRequestException({
        message: `Giá sale phải nhỏ hơn giá gốc (${variant.price.toString()}).`,
        code: ErrorCode.FLASH_SALE_INVALID_SALE_PRICE,
      });
    }
    if (item.quantityLimit > variant.stockQuantity) {
      throw new BadRequestException({
        message: `Số lượng giới hạn không được vượt quá tồn kho hiện tại (${variant.stockQuantity}).`,
        code: ErrorCode.FLASH_SALE_QUANTITY_EXCEEDS_STOCK,
      });
    }
  }

  // Chặn trùng biến thể: tìm FlashSaleItem khác (loại trừ chính campaign đang sửa) cho cùng
  // biến thể, mà FlashSale cha CHƯA ENDED (endDate >= now) VÀ khung giờ giao nhau với
  // [startDate, endDate] mới. 3 điều kiện đều nằm trên field `endDate`/`startDate` của
  // flashSale nên PHẢI gộp bằng AND — không viết trùng key `endDate` 2 lần trong cùng object
  // (object literal sẽ ghi đè lẫn nhau, chỉ giữ lại điều kiện viết sau).
  const now = new Date();
  const overlapping = await prisma.flashSaleItem.findMany({
    where: {
      productVariantId: { in: variantIds },
      ...(excludeFlashSaleId ? { flashSaleId: { not: excludeFlashSaleId } } : {}),
      flashSale: {
        isDelete: false,
        AND: [
          { endDate: { gte: now } },
          { startDate: { lte: endDate } },
          { endDate: { gte: startDate } },
        ],
      },
    },
    include: {
      flashSale: { select: { name: true } },
      productVariant: { select: { sku: true } },
    },
  });
  if (overlapping.length > 0) {
    const first = overlapping[0];
    throw new ConflictException({
      message: `Biến thể (SKU: ${first.productVariant.sku}) đã tham gia đợt Flash Sale "${first.flashSale.name}" trong cùng khoảng thời gian.`,
      code: ErrorCode.FLASH_SALE_VARIANT_OVERLAP,
    });
  }

  return items.map((item) => ({
    productVariantId: item.productVariantId,
    salePrice: new Prisma.Decimal(item.salePrice),
    quantityLimit: item.quantityLimit,
  }));
}
```

Thêm import còn thiếu ở đầu file `flash-sales.service.ts`:

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FlashSaleItemInputDto } from './dto/flash-sale-item-input.dto';
```

(gộp `BadRequestException`, `ConflictException` vào cùng dòng import `@nestjs/common` đã có
từ Task 6, không tạo dòng import trùng).

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: PASS toàn bộ (11 test: 5 từ Task 6 + 6 từ Task 7).

- [ ] **Step 5: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/flash-sales/flash-sales.service.ts src/modules/flash-sales/flash-sales.service.spec.ts
git commit -m "feat(flash-sales): validate giá/tồn kho/trùng biến thể khi tạo-sửa item"
```

---

### Task 8: `FlashSalesService` — ghi dữ liệu (create/update/endNow/remove/updateSoldCount)

**Files:**
- Modify: `src/modules/flash-sales/flash-sales.service.ts`
- Test: `src/modules/flash-sales/flash-sales.service.spec.ts`

**Interfaces:**
- Consumes: `validateFlashSaleItems()` (Task 7), `findExisting()` (Task 6, private — cần đổi
  visibility hoặc gọi qua method public khác, xem Step 3), `isDateInPast()` (Task 2).
- Produces: `FlashSalesService.create(dto: CreateFlashSaleDto): Promise<FlashSaleDetail>`,
  `.update(id, dto: UpdateFlashSaleDto): Promise<FlashSaleDetail>`,
  `.endNow(id: string): Promise<FlashSaleDetail>`, `.remove(id: string): Promise<void>`,
  `.updateSoldCount(id: string, itemId: string, dto: UpdateSoldCountDto): Promise<FlashSaleDetail>`.

- [ ] **Step 1: Viết test cho luật sửa theo trạng thái + kết thúc sớm + xóa + sold-count**

Thêm vào cuối `src/modules/flash-sales/flash-sales.service.spec.ts`:

```typescript
describe('FlashSalesService.update — luật theo trạng thái', () => {
  function createUpdateMocks() {
    const findUnique = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const flashSaleItemDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const transaction = jest.fn((cb: (tx: unknown) => unknown) =>
      typeof cb === 'function'
        ? cb({
            flashSale: { update },
            flashSaleItem: { deleteMany: flashSaleItemDeleteMany },
          })
        : Promise.all(cb as unknown as Promise<unknown>[]),
    );
    const prisma = {
      flashSale: { findUnique, update },
      flashSaleItem: { deleteMany: flashSaleItemDeleteMany },
      $transaction: transaction,
    } as unknown as PrismaService;
    return { prisma, findUnique, update, flashSaleItemDeleteMany, transaction };
  }

  it('RUNNING + chỉ sửa endDate -> cho phép', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.update('fs-1', { endDate: new Date().toISOString() });

    expect(update).toHaveBeenCalled();
  });

  it('RUNNING + cố sửa name -> ConflictException kèm code 2206, không gọi update', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.update('fs-1', { name: 'Tên mới' });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2206 });
    expect(update).not.toHaveBeenCalled();
  });

  it('ENDED + sửa bất kỳ field nào -> ConflictException kèm code 2207', async () => {
    const { prisma, findUnique, update } = createUpdateMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      name: 'Flash Sale',
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-02-01'),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.update('fs-1', { endDate: new Date().toISOString() });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2207 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('FlashSalesService.endNow', () => {
  function createEndNowMocks() {
    const findUnique = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const prisma = { flashSale: { findUnique, update } } as unknown as PrismaService;
    return { prisma, findUnique, update };
  }

  it('đang RUNNING -> set endDate về hiện tại', async () => {
    const { prisma, findUnique, update } = createEndNowMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    findUnique.mockResolvedValueOnce({ id: 'fs-1', items: [] });
    const service = new FlashSalesService(prisma);

    await service.endNow('fs-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fs-1' },
        data: { endDate: expect.any(Date) as Date },
      }),
    );
  });

  it('chưa RUNNING (UPCOMING) -> ConflictException kèm code 2211, không gọi update', async () => {
    const { prisma, findUnique, update } = createEndNowMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await expect(service.endNow('fs-1')).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('FlashSalesService.remove', () => {
  function createRemoveMocks() {
    const findUnique = jest.fn();
    const transaction = jest.fn().mockResolvedValue([]);
    const prisma = {
      flashSale: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService;
    return { prisma, findUnique, transaction };
  }

  it('đang RUNNING -> ConflictException kèm code 2208, không xóa', async () => {
    const { prisma, findUnique, transaction } = createRemoveMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 86400000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await expect(service.remove('fs-1')).rejects.toMatchObject({ status: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('UPCOMING -> xóa mềm thành công', async () => {
    const { prisma, findUnique, transaction } = createRemoveMocks();
    findUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    await service.remove('fs-1');

    expect(transaction).toHaveBeenCalled();
  });
});

describe('FlashSalesService.updateSoldCount', () => {
  function createSoldCountMocks() {
    const itemFindUnique = jest.fn();
    const itemUpdate = jest.fn().mockResolvedValue({});
    const flashSaleFindUnique = jest.fn();
    const prisma = {
      flashSaleItem: { findUnique: itemFindUnique, update: itemUpdate },
      flashSale: { findUnique: flashSaleFindUnique },
    } as unknown as PrismaService;
    return { prisma, itemFindUnique, itemUpdate, flashSaleFindUnique };
  }

  it('soldCount vượt quantityLimit -> BadRequestException kèm code 2210', async () => {
    const { prisma, itemFindUnique } = createSoldCountMocks();
    itemFindUnique.mockResolvedValue({ id: 'item-1', flashSaleId: 'fs-1', quantityLimit: 5 });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.updateSoldCount('fs-1', 'item-1', { soldCount: 6 });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2210 });
  });

  it('item không thuộc đúng flash sale -> NotFoundException kèm code 2209', async () => {
    const { prisma, itemFindUnique } = createSoldCountMocks();
    itemFindUnique.mockResolvedValue({ id: 'item-1', flashSaleId: 'other-fs', quantityLimit: 5 });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.updateSoldCount('fs-1', 'item-1', { soldCount: 1 });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2209 });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** (chưa có `create`/`update`/`endNow`/`remove`/
  `updateSoldCount`)

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: FAIL — `service.update is not a function` (và tương tự cho các method khác); test
Task 6+7 vẫn PASS.

- [ ] **Step 3: Đổi `findExisting` từ `private` sang không khai báo access modifier (mặc
  định `public`) trong `flash-sales.service.ts`** — các method mới ở bước sau đều cần gọi lại
  nó, giữ `private` vẫn gọi được TRONG CÙNG class nên thực ra KHÔNG cần đổi gì (private chỉ
  chặn gọi từ NGOÀI class) — bỏ qua bước này, `findExisting` giữ nguyên `private`.

- [ ] **Step 4: Thêm 5 method vào class `FlashSalesService`** (chèn vào SAU `findOne()`,
  TRƯỚC `findExisting()` — trong `flash-sales.service.ts`)

```typescript
  async create(dto: CreateFlashSaleDto): Promise<FlashSaleDetail> {
    assertDateRange(dto.startDate, dto.endDate);
    assertStartDateNotInPast(dto.startDate);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    const items = await validateFlashSaleItems(this.prisma, dto.items, startDate, endDate, null);

    const created = await this.prisma.flashSale.create({
      data: {
        name: dto.name,
        startDate,
        endDate,
        items: { create: items },
      },
    });
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateFlashSaleDto): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveDateRangeStatus(existing.startDate, existing.endDate);

    if (status === 'ENDED') {
      throw new ConflictException({
        message: 'Đợt Flash Sale đã kết thúc — không thể chỉnh sửa.',
        code: ErrorCode.FLASH_SALE_UPDATE_BLOCKED_ENDED,
      });
    }
    if (status === 'RUNNING') {
      const attemptingBlockedField =
        dto.name !== undefined || dto.startDate !== undefined || dto.items !== undefined;
      if (attemptingBlockedField) {
        throw new ConflictException({
          message: 'Đợt Flash Sale đang diễn ra — chỉ có thể sửa ngày kết thúc.',
          code: ErrorCode.FLASH_SALE_UPDATE_FIELD_BLOCKED_RUNNING,
        });
      }
    }

    const startDate = dto.startDate ?? existing.startDate.toISOString();
    const endDate = dto.endDate ?? existing.endDate.toISOString();
    assertDateRange(startDate, endDate);
    if (status === 'UPCOMING' && dto.startDate) {
      assertStartDateNotInPast(dto.startDate);
    }

    if (dto.items) {
      const items = await validateFlashSaleItems(
        this.prisma,
        dto.items,
        new Date(startDate),
        new Date(endDate),
        id,
      );
      await this.prisma.$transaction([
        this.prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } }),
        this.prisma.flashSale.update({
          where: { id },
          data: {
            name: dto.name,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            items: { create: items },
          },
        }),
      ]);
    } else {
      await this.prisma.flashSale.update({
        where: { id },
        data: {
          name: dto.name,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });
    }

    return this.findOne(id);
  }

  async endNow(id: string): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveDateRangeStatus(existing.startDate, existing.endDate);
    if (status !== 'RUNNING') {
      throw new ConflictException({
        message: 'Chỉ có thể kết thúc sớm đợt đang diễn ra.',
        code: ErrorCode.FLASH_SALE_END_NOW_NOT_RUNNING,
      });
    }
    await this.prisma.flashSale.update({ where: { id }, data: { endDate: new Date() } });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findExisting(id);
    const status = deriveDateRangeStatus(existing.startDate, existing.endDate);
    if (status === 'RUNNING') {
      throw new ConflictException({
        message: 'Không thể xóa đợt Flash Sale đang diễn ra.',
        code: ErrorCode.FLASH_SALE_DELETE_BLOCKED_RUNNING,
      });
    }
    await this.prisma.$transaction([
      this.prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } }),
      this.prisma.flashSale.update({ where: { id }, data: { isDelete: true } }),
    ]);
  }

  async updateSoldCount(
    id: string,
    itemId: string,
    dto: UpdateSoldCountDto,
  ): Promise<FlashSaleDetail> {
    const item = await this.prisma.flashSaleItem.findUnique({ where: { id: itemId } });
    if (!item || item.flashSaleId !== id) {
      throw new NotFoundException({
        message: 'Không tìm thấy sản phẩm trong đợt Flash Sale.',
        code: ErrorCode.FLASH_SALE_ITEM_NOT_FOUND,
      });
    }
    if (dto.soldCount > item.quantityLimit) {
      throw new BadRequestException({
        message: `Số đã bán không được vượt quá giới hạn (${item.quantityLimit}).`,
        code: ErrorCode.FLASH_SALE_SOLD_COUNT_EXCEEDS_LIMIT,
      });
    }
    await this.prisma.flashSaleItem.update({
      where: { id: itemId },
      data: { soldCount: dto.soldCount },
    });
    return this.findOne(id);
  }
```

Thêm hàm `assertStartDateNotInPast` module-level vào CUỐI file (cạnh `validateFlashSaleItems`
và `toDetail`):

```typescript
function assertStartDateNotInPast(startDate: string): void {
  if (isDateInPast(startDate)) {
    throw new BadRequestException({
      message: 'Ngày bắt đầu không được ở trong quá khứ.',
      code: ErrorCode.FLASH_SALE_START_DATE_IN_PAST,
    });
  }
}
```

Bổ sung import còn thiếu ở đầu file:

```typescript
import { assertDateRange, isDateInPast } from '../../common/utils/date.util';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { UpdateSoldCountDto } from './dto/update-sold-count.dto';
```

(gộp `deriveDateRangeStatus`/`isDateInPast`/`assertDateRange` vào 1 dòng import
`'../../common/utils/date.util'` duy nhất, không tách nhiều dòng trùng nguồn.)

- [ ] **Step 5: Chạy test, xác nhận PASS**

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: PASS toàn bộ (11 test Task 6+7 + 9 test Task 8 = 20 test).

- [ ] **Step 6: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: 0 lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/modules/flash-sales/flash-sales.service.ts src/modules/flash-sales/flash-sales.service.spec.ts
git commit -m "feat(flash-sales): create/update/endNow/remove/updateSoldCount"
```

---

### Task 9: Controller + Module + đăng ký vào app, verify API thật

**Files:**
- Create: `src/modules/flash-sales/flash-sales.controller.ts`
- Create: `src/modules/flash-sales/flash-sales.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `FlashSalesService` (Task 6-8), tất cả DTO (Task 5), `JwtAuthGuard`,
  `RolesGuard`, `Roles`, `ADMIN_PANEL_ROLES`, `UserRole` (đã có sẵn trong codebase).

- [ ] **Step 1: Tạo `flash-sales.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { FlashSalesService } from './flash-sales.service';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { ListFlashSalesQueryDto } from './dto/list-flash-sales-query.dto';
import { UpdateSoldCountDto } from './dto/update-sold-count.dto';

@ApiTags('flash-sales')
@ApiBearerAuth()
@Controller('flash-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách Flash Sale (tìm theo tên, lọc trạng thái, phân trang)' })
  findAll(@Query() query: ListFlashSalesQueryDto) {
    return this.flashSalesService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 đợt Flash Sale' })
  findOne(@Param('id') id: string) {
    return this.flashSalesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo đợt Flash Sale mới (Admin, Marketing)' })
  create(@Body() dto: CreateFlashSaleDto) {
    return this.flashSalesService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật đợt Flash Sale (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateFlashSaleDto) {
    return this.flashSalesService.update(id, dto);
  }

  @Patch(':id/end-now')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Kết thúc sớm đợt Flash Sale đang diễn ra (Admin, Marketing)' })
  endNow(@Param('id') id: string) {
    return this.flashSalesService.endNow(id);
  }

  @Patch(':id/items/:itemId/sold-count')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Chỉnh tay số đã bán của 1 sản phẩm trong đợt (Admin, Marketing)' })
  updateSoldCount(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSoldCountDto,
  ) {
    return this.flashSalesService.updateSoldCount(id, itemId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa mềm đợt Flash Sale (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.flashSalesService.remove(id);
  }
}
```

- [ ] **Step 2: Tạo `flash-sales.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { FlashSalesController } from './flash-sales.controller';
import { FlashSalesService } from './flash-sales.service';

@Module({
  controllers: [FlashSalesController],
  providers: [FlashSalesService],
  exports: [FlashSalesService],
})
export class FlashSalesModule {}
```

- [ ] **Step 3: Đăng ký `FlashSalesModule` vào `src/app.module.ts`**

Thêm import (cạnh các module khác), và thêm `FlashSalesModule` vào mảng `imports` của
`AppModule`. Vị trí chính xác import/tên biến tùy theo cấu trúc hiện tại của file — mở file
`src/app.module.ts`, tìm import cuối cùng của 1 module tương tự (vd `VouchersModule`) làm mẫu.

- [ ] **Step 4: Chạy toàn bộ test backend-cms**

```bash
pnpm --filter @clothing-shop/be test
```

Expected: PASS toàn bộ (không chỉ riêng flash-sales — xác nhận không phá test module khác).

- [ ] **Step 5: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: 0 lỗi.

- [ ] **Step 6: Khởi động dev server, verify API thật qua Swagger**

Tắt dev server cũ nếu đang chạy (xem Global Constraints), sau đó:

```bash
pnpm --filter @clothing-shop/be start:dev
```

Đợi server lên (`curl http://localhost:3002/api/docs` trả 200), sau đó login admin lấy token,
tạo thử 1 flash sale với 1 item hợp lệ, gọi GET list/detail xác nhận trả đúng cấu trúc, gọi
lại POST với `salePrice` >= giá gốc xác nhận trả 400 kèm `code: 2203`, gọi `end-now` với 1
flash sale UPCOMING xác nhận trả 409 kèm `code: 2211`, cuối cùng DELETE dữ liệu test vừa tạo
để không để lại rác trong DB.

- [ ] **Step 7: Commit**

```bash
git add src/modules/flash-sales/flash-sales.controller.ts src/modules/flash-sales/flash-sales.module.ts src/app.module.ts
git commit -m "feat(flash-sales): controller + module, đăng ký vào app"
```

---

## Self-Review (đã tự soát trước khi bàn giao)

- **Spec coverage**: đủ 6/6 endpoint trong spec (list/detail/create/update/end-now/
  sold-count/delete — 7 thật ra, đã đếm đủ), đủ luật sửa theo status, đủ validate giá/tồn
  kho/trùng biến thể, đủ error code range riêng.
- **Placeholder scan**: không còn "TODO"/"tương tự Task N" nào — mọi step đều có code đầy đủ.
- **Type consistency**: `FlashSaleListItem`/`FlashSaleDetail`/`FlashSaleItemDetail` định
  nghĩa 1 lần ở Task 6, dùng lại nguyên xi xuyên suốt Task 7-9, không đổi tên field giữa các
  task.
