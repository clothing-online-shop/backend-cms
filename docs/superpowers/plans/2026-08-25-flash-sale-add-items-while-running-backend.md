# Flash Sale — Thêm sản phẩm khi RUNNING (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm `POST /flash-sales/:id/items` — cho phép cộng thêm sản phẩm/biến thể vào 1 đợt
Flash Sale đang RUNNING, không đụng tới item đã có từ trước (không xóa, không sửa).

**Architecture:** 1 method mới `FlashSalesService.addItems()` tái dùng nguyên
`validateFlashSaleItems()` đã có (giá/tồn kho/dedupe/overlap), chỉ `createMany` thêm dòng mới —
KHÔNG có bước `deleteMany` nào (khác hẳn `update()`'s items-branch, vốn thay thế toàn bộ). 1 DTO
mới bọc lại `FlashSaleItemInputDto[]` đã có. 1 error code mới cho guard trạng thái.

**Tech Stack:** NestJS, Prisma, PostgreSQL, class-validator, Jest.

## Global Constraints

- Spec đầy đủ: `docs/superpowers/specs/2026-08-25-flash-sale-add-items-while-running-design.md`
  — đọc trước khi bắt đầu nếu cần thêm ngữ cảnh, plan này đã trích đủ chi tiết cần thiết.
- Đây là bổ sung cho nhánh `feature/flash-sale` ĐÃ CÓ SẴN (chưa merge/push) — không tạo nhánh
  mới, code tiếp lên đúng nhánh này. Xác nhận đang đứng đúng nhánh trước khi bắt đầu:
  `git branch --show-current` phải ra `feature/flash-sale`.
- Item CŨ (đã có trước khi gọi endpoint mới) đóng băng hoàn toàn — không sửa, không xóa. Chỉ
  INSERT thêm dòng mới. Không có giới hạn số lần/số lượng thêm, không chặn theo thời gian còn
  lại của campaign.
- Endpoint mới CHỈ áp dụng cho status RUNNING — UPCOMING vẫn dùng cơ chế `PATCH` thay thế toàn
  bộ `items` như hiện có, không đổi gì ở đó.
- Validate item mới giống hệt lúc tạo mới: tái dùng nguyên `validateFlashSaleItems()`.
- Gọi `validateFlashSaleItems(..., excludeFlashSaleId: null)` (KHÔNG truyền id của chính
  campaign) — để `assertNoVariantOverlap()` tự bắt luôn trường hợp trùng với item cũ **của
  chính campaign này** (vì item cũ không hề bị xóa trước khi validate, khác với nhánh UPCOMING).
- Error code mới tiếp nối dải Flash Sale hiện có (2201-2213):
  `FLASH_SALE_ADD_ITEMS_NOT_RUNNING: 2214`.
- Role: `ADMIN`, `MARKETING` — giống mọi endpoint ghi khác của Flash Sale.
- Lint 0 lỗi (`pnpm --filter @clothing-shop/be lint`), build sạch
  (`pnpm --filter @clothing-shop/be build`), full test suite pass trước khi coi 1 task xong.
- PostgreSQL + Redis chạy qua Docker Desktop (container tên `clothing-shop-postgres`/
  `clothing-shop-redis`, có sẵn restart policy). Nếu Docker chưa chạy: mở Docker Desktop
  (`start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"` qua Bash), đợi `docker ps`
  chạy được là container tự lên (đã gặp và xử lý được nhiều lần trong session trước). Dev
  server backend-cms/frontend-admin hiện KHÔNG chạy sẵn (đã tắt ở cuối phiên trước) — task nào
  cần server thật phải tự khởi động.
- Trước khi chạy lệnh cần dev server tắt (không áp dụng ở plan này — không đổi Prisma schema,
  không cần `migrate dev`).

---

### Task 1: Error code `FLASH_SALE_ADD_ITEMS_NOT_RUNNING`

**Files:**
- Modify: `src/common/constants/error-codes/flash-sale.ts`

**Interfaces:**
- Produces: `ErrorCode.FLASH_SALE_ADD_ITEMS_NOT_RUNNING` = `2214` (gộp sẵn qua
  `FlashSaleErrorCode` → `ErrorCode` ở `index.ts`, không cần sửa `index.ts` — file đó đã
  spread `...FlashSaleErrorCode` từ trước).

- [ ] **Step 1: Thêm mã lỗi vào `FlashSaleErrorCode`** — sửa
  `src/common/constants/error-codes/flash-sale.ts`, thêm dòng cuối cùng trong object (sau
  `FLASH_SALE_DUPLICATE_VARIANT: 2213,`):

```typescript
  FLASH_SALE_ADD_ITEMS_NOT_RUNNING: 2214,
```

File sau khi sửa (`FlashSaleErrorCode` object) trông như sau — chỉ để đối chiếu, không cần
chép lại phần message map hiện có (không đổi trong task này):

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
  FLASH_SALE_DUPLICATE_VARIANT: 2213,
  FLASH_SALE_ADD_ITEMS_NOT_RUNNING: 2214,
} as const;
```

- [ ] **Step 2: Build để xác nhận không lỗi, không trùng số với domain khác**

```bash
pnpm --filter @clothing-shop/be build
```

Expected: build qua sạch.

- [ ] **Step 3: Commit**

```bash
git add src/common/constants/error-codes/flash-sale.ts
git commit -m "feat(flash-sales): thêm error code FLASH_SALE_ADD_ITEMS_NOT_RUNNING"
```

---

### Task 2: DTO `AddFlashSaleItemsDto`

**Files:**
- Create: `src/modules/flash-sales/dto/add-flash-sale-items.dto.ts`

**Interfaces:**
- Consumes: `FlashSaleItemInputDto` (`./flash-sale-item-input.dto`, đã có sẵn — field
  `productVariantId: string`, `salePrice: number`, `quantityLimit: number`).
- Produces: `AddFlashSaleItemsDto { items: FlashSaleItemInputDto[] }` — Task 4 (controller)
  import trực tiếp.

- [ ] **Step 1: Tạo `src/modules/flash-sales/dto/add-flash-sale-items.dto.ts`** — theo đúng
  khuôn `CreateFlashSaleDto.items` đã có (cùng bộ decorator: `@IsArray()` +
  `@ArrayMinSize(1)` + `@ValidateNested({ each: true })` + `@Type(() => FlashSaleItemInputDto)`):

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { FlashSaleItemInputDto } from './flash-sale-item-input.dto';

export class AddFlashSaleItemsDto {
  @ApiProperty({
    type: [FlashSaleItemInputDto],
    description:
      'Danh sách sản phẩm/biến thể muốn THÊM vào đợt đang diễn ra — ít nhất 1 dòng. Không ảnh hưởng tới sản phẩm đã có sẵn trong đợt (không xóa, không sửa).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlashSaleItemInputDto)
  items!: FlashSaleItemInputDto[];
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @clothing-shop/be build
```

Expected: qua sạch — DTO độc lập, không phụ thuộc service/controller chưa tồn tại.

- [ ] **Step 3: Commit**

```bash
git add src/modules/flash-sales/dto/add-flash-sale-items.dto.ts
git commit -m "feat(flash-sales): thêm DTO AddFlashSaleItemsDto"
```

---

### Task 3: `FlashSalesService.addItems()`

**Files:**
- Modify: `src/modules/flash-sales/flash-sales.service.ts`
- Test: `src/modules/flash-sales/flash-sales.service.spec.ts`

**Interfaces:**
- Consumes: `validateFlashSaleItems()` (module-level, đã có sẵn cuối file — 5 tham số
  `(prisma, items, startDate, endDate, excludeFlashSaleId)`), `findExisting()` (private method
  đã có, trả về `FlashSale` trần gồm `startDate`/`endDate`/`isDelete`),
  `deriveInstantRangeStatus()` (`../../common/utils/date.util`, đã import sẵn trong file),
  `AddFlashSaleItemsDto` (Task 2), `ErrorCode.FLASH_SALE_ADD_ITEMS_NOT_RUNNING` (Task 1).
- Produces: `FlashSalesService.addItems(id: string, dto: AddFlashSaleItemsDto):
  Promise<FlashSaleDetail>` — Task 4 (controller) gọi trực tiếp.

- [ ] **Step 1: Viết test (RED)** — thêm vào cuối `flash-sales.service.spec.ts` (sau
  `describe('FlashSalesService.updateSoldCount', ...)`, dùng lại hàm `variant()` đã định nghĩa
  ở đầu file cho mock biến thể):

```typescript
describe('FlashSalesService.addItems', () => {
  function createAddItemsMocks() {
    const flashSaleFindUnique = jest.fn();
    const variantFindMany = jest.fn();
    const itemFindMany = jest.fn();
    const itemCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      flashSale: { findUnique: flashSaleFindUnique },
      productVariant: { findMany: variantFindMany },
      flashSaleItem: { findMany: itemFindMany, createMany: itemCreateMany },
    } as unknown as PrismaService;
    return {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    };
  }

  it('không phải RUNNING (UPCOMING) -> ConflictException kèm code 2214, không gọi createMany', async () => {
    const { prisma, flashSaleFindUnique, itemCreateMany } =
      createAddItemsMocks();
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 172800000),
      isDelete: false,
    });
    const service = new FlashSalesService(prisma);

    let caught: { getResponse: () => unknown } | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
        ],
      });
    } catch (err) {
      caught = err as { getResponse: () => unknown };
    }
    expect(caught?.getResponse()).toMatchObject({ code: 2214 });
    expect(itemCreateMany).not.toHaveBeenCalled();
  });

  it('RUNNING + item hợp lệ -> createMany thêm item mới, KHÔNG gọi deleteMany bao giờ', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([
      variant({ id: 'variant-2', price: 200000, stockQuantity: 10 }),
    ]);
    itemFindMany.mockResolvedValue([]);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      items: [],
    });
    const service = new FlashSalesService(prisma);

    await service.addItems('fs-1', {
      items: [
        { productVariantId: 'variant-2', salePrice: 150000, quantityLimit: 3 },
      ],
    });

    expect(itemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          productVariantId: 'variant-2',
          salePrice: new Prisma.Decimal(150000),
          quantityLimit: 3,
          flashSaleId: 'fs-1',
        },
      ],
    });
    // KHÔNG mock prisma.flashSaleItem.deleteMany ở test này — nếu addItems() lỡ gọi
    // deleteMany (giống nhầm sang cơ chế thay thế toàn bộ của update()), test sẽ crash ngay
    // tại đây vì "deleteMany is not a function", tự bắt được deviation quan trọng nhất.
  });

  it('RUNNING + trùng biến thể đã có sẵn trong chính campaign -> ConflictException kèm code 2205', async () => {
    const {
      prisma,
      flashSaleFindUnique,
      variantFindMany,
      itemFindMany,
      itemCreateMany,
    } = createAddItemsMocks();
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 86400000);
    flashSaleFindUnique.mockResolvedValueOnce({
      id: 'fs-1',
      startDate,
      endDate,
      isDelete: false,
    });
    variantFindMany.mockResolvedValue([variant({ id: 'variant-1' })]);
    // Item trùng thuộc CHÍNH campaign đang thêm (flashSaleId: 'fs-1') — addItems() gọi
    // validateFlashSaleItems() với excludeFlashSaleId=null (không loại trừ chính nó), nên
    // overlap-check phải tự bắt được trường hợp "thêm lại 1 biến thể đã có sẵn".
    itemFindMany.mockResolvedValue([
      {
        productVariantId: 'variant-1',
        flashSaleId: 'fs-1',
        flashSale: { name: 'Flash Sale' },
        productVariant: { sku: 'SKU-1' },
      },
    ]);
    const service = new FlashSalesService(prisma);

    let caught: ConflictException | undefined;
    try {
      await service.addItems('fs-1', {
        items: [
          { productVariantId: 'variant-1', salePrice: 1000, quantityLimit: 1 },
        ],
      });
    } catch (err) {
      caught = err as ConflictException;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.getResponse()).toMatchObject({ code: 2205 });
    expect(itemCreateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL** (method chưa tồn tại)

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: FAIL — `service.addItems is not a function` ở cả 3 test mới; mọi test khác trong
file vẫn PASS.

- [ ] **Step 3: Viết `addItems()`** — thêm vào class `FlashSalesService`, chèn ngay SAU
  `updateSoldCount()` và TRƯỚC `findExisting()`:

```typescript
  async addItems(
    id: string,
    dto: AddFlashSaleItemsDto,
  ): Promise<FlashSaleDetail> {
    const existing = await this.findExisting(id);
    const status = deriveInstantRangeStatus(
      existing.startDate,
      existing.endDate,
    );
    if (status !== 'RUNNING') {
      throw new ConflictException({
        message: 'Chỉ có thể thêm sản phẩm vào đợt Flash Sale đang diễn ra.',
        code: ErrorCode.FLASH_SALE_ADD_ITEMS_NOT_RUNNING,
      });
    }

    // excludeFlashSaleId: null (không loại trừ chính campaign này) — khác nhánh update()'s
    // items-branch (dùng id chính nó để loại trừ, vì lúc đó item cũ đã bị xóa trước khi validate).
    // Ở đây item cũ KHÔNG bị xóa, nên overlap-check phải tự nhiên bắt được cả trường hợp thêm
    // lại 1 biến thể đã có sẵn trong chính campaign này.
    const items = await validateFlashSaleItems(
      this.prisma,
      dto.items,
      existing.startDate,
      existing.endDate,
      null,
    );

    // CHỈ createMany — không có bước deleteMany nào, khác hẳn update()'s items-branch (vốn
    // thay thế toàn bộ). Đây là điểm cốt lõi của toàn bộ tính năng: "chỉ được cộng thêm".
    await this.prisma.flashSaleItem.createMany({
      data: items.map((item) => ({ ...item, flashSaleId: id })),
    });

    return this.findOne(id);
  }
```

Thêm import `AddFlashSaleItemsDto` vào đầu file, cạnh các import DTO khác:

```typescript
import { AddFlashSaleItemsDto } from './dto/add-flash-sale-items.dto';
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

```bash
pnpm --filter @clothing-shop/be test -- flash-sales.service.spec
```

Expected: PASS toàn bộ — 3 test mới + mọi test đã có từ trước (không giảm số lượng).

- [ ] **Step 5: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: 0 lỗi. Nếu `pnpm lint` chạy `eslint --fix` reformat thêm file KHÔNG liên quan tới
task này (đã gặp nhiều lần trong session trước — whole-repo autofix động vào DTO khác), kiểm
tra `git status`/`git diff --stat` trước khi commit và revert phần ngoài phạm vi (`git checkout
-- <file không liên quan>`), chỉ giữ lại thay đổi ở 2 file của task này.

- [ ] **Step 6: Commit**

```bash
git add src/modules/flash-sales/flash-sales.service.ts src/modules/flash-sales/flash-sales.service.spec.ts
git commit -m "feat(flash-sales): thêm FlashSalesService.addItems() — cộng thêm sản phẩm khi RUNNING"
```

---

### Task 4: Controller endpoint + verify API thật

**Files:**
- Modify: `src/modules/flash-sales/flash-sales.controller.ts`

**Interfaces:**
- Consumes: `FlashSalesService.addItems()` (Task 3), `AddFlashSaleItemsDto` (Task 2).
- Produces: `POST /flash-sales/:id/items` — endpoint thật, không có task nào sau dùng lại.

- [ ] **Step 1: Thêm import + endpoint vào `flash-sales.controller.ts`**

Thêm import (cạnh các import DTO khác):

```typescript
import { AddFlashSaleItemsDto } from './dto/add-flash-sale-items.dto';
```

Thêm method vào class `FlashSalesController`, chèn giữa `endNow()` và
`updateSoldCount()` (theo đúng thứ tự route liên quan tới items trong file):

```typescript
  @Post(':id/items')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary:
      'Thêm sản phẩm vào đợt Flash Sale đang diễn ra — chỉ cộng thêm, không xóa/sửa sản phẩm đã có (Admin, Marketing)',
  })
  addItems(@Param('id') id: string, @Body() dto: AddFlashSaleItemsDto) {
    return this.flashSalesService.addItems(id, dto);
  }
```

- [ ] **Step 2: Chạy full test suite backend-cms**

```bash
pnpm --filter @clothing-shop/be test
```

Expected: PASS toàn bộ (không chỉ riêng flash-sales — xác nhận không phá module khác).

- [ ] **Step 3: Lint + build**

```bash
pnpm --filter @clothing-shop/be lint
pnpm --filter @clothing-shop/be build
```

Expected: 0 lỗi.

- [ ] **Step 4: Khởi động dev server, verify API thật qua Swagger**

Kiểm tra Docker trước (Postgres/Redis) theo Global Constraints — nếu `docker ps` báo lỗi kết
nối, mở Docker Desktop và đợi container lên healthy trước khi tiếp tục.

```bash
pnpm --filter @clothing-shop/be start:dev
```

Đợi server lên (`curl http://localhost:3002/api/docs` trả 200). Sau đó login admin lấy token,
tìm 1 flash sale RUNNING có sẵn trong DB (hoặc tạo mới 1 đợt với `startDate` vài giây trong
tương lai gần rồi đợi qua thời điểm đó để nó tự chuyển RUNNING — status suy runtime, không cần
sửa gì thủ công), rồi:

1. Gọi `POST /flash-sales/:id/items` với 1 biến thể hợp lệ (chưa có trong đợt) → xác nhận trả
   200 kèm `FlashSaleDetail` có thêm đúng item mới, các item cũ (nếu có) vẫn còn nguyên y hệt.
2. Gọi lại `POST /flash-sales/:id/items` với ĐÚNG biến thể vừa thêm ở bước 1 → xác nhận trả 409
   kèm `code: 2205` (trùng với chính campaign).
3. Tìm 1 flash sale UPCOMING (hoặc tạo mới, chưa tới `startDate`), gọi `POST
   /flash-sales/:id/items` → xác nhận trả 409 kèm `code: 2214`.
4. Dọn dữ liệu test đã tạo (nếu có tạo campaign/item mới riêng cho bước verify này) — xóa qua
   `DELETE /flash-sales/:id` nếu trạng thái cho phép, hoặc để lại nếu đang RUNNING (không xóa
   được theo đúng luật hiện có) và ghi chú lại cho người review biết.
5. Tắt dev server sau khi xong (trên Windows kiểm tra tiến trình `node.exe` mồ côi theo cách đã
   dùng nhiều lần trong session trước, đảm bảo không để sót giữ khoá file).

- [ ] **Step 5: Commit**

```bash
git add src/modules/flash-sales/flash-sales.controller.ts
git commit -m "feat(flash-sales): thêm endpoint POST /flash-sales/:id/items"
```

---

## Self-Review (đã tự soát trước khi bàn giao)

- **Spec coverage:** đủ endpoint mới, guard trạng thái RUNNING-only, tái dùng
  `validateFlashSaleItems()`, `excludeFlashSaleId: null` để tự bắt trùng với chính campaign,
  không giới hạn số lần/số lượng, không chặn theo thời gian còn lại (không có logic nào chặn
  2 điều này — đúng ý "không làm gì thêm" của spec, không cần task riêng cho việc "không làm").
- **Placeholder scan:** không còn "TBD"/"tương tự Task N" — mọi step có code đầy đủ.
- **Type consistency:** `AddFlashSaleItemsDto` định nghĩa 1 lần ở Task 2, dùng nhất quán ở
  Task 3 (`addItems(id, dto: AddFlashSaleItemsDto)`) và Task 4 (controller). `addItems()`'s
  return type `FlashSaleDetail` khớp với type đã có sẵn trong `flash-sales.service.ts`, không
  định nghĩa lại.
