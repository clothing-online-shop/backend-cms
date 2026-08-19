# GHN Shipping Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ProductVariant.weight` and switch `Address` from free-text province/district/ward to FK references into the existing `Province`/`District`/`Ward` tables, so `backend-user` can map addresses to GHN location codes and sum order weight for shipping-fee calculation.

**Architecture:** Two independent Prisma schema changes on the shared schema this repo owns, each with its own migration. `ProductVariant.weight` is additive and nullable (no data loss). The `Address` change replaces columns and is destructive to any existing free-text address data — see Task 2's pre-flight check.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL, class-validator/class-transformer, Jest.

**Spec:** [`docs/superpowers/specs/2026-08-19-ghn-shipping-schema-design.md`](../specs/2026-08-19-ghn-shipping-schema-design.md)

## Global Constraints

- 1 module = 1 domain, controller only calls service, business logic in `*.service.ts` (CLAUDE.md).
- Every DTO field needs `@ApiProperty()`/`@ApiPropertyOptional()` for Swagger — no hand-written docs (CLAUDE.md).
- Schema changes go through `prisma/schema.prisma` then `pnpm --filter @clothing-shop/be prisma:migrate` — never hand-edit an applied migration, never touch the DB directly for structural changes (CLAUDE.md).
- Relations with a foreign key need `@@index` on that key, matching existing models (CLAUDE.md).
- Before opening a PR: `pnpm --filter @clothing-shop/be lint` (0 errors), `pnpm --filter @clothing-shop/be build` (passes), and if schema changed, migration must apply cleanly from scratch (CLAUDE.md).
- Branch: `feature/ghn-shipping-schema` (already created from `fix-develop`, spec doc already committed as `628ae01`).

---

### Task 1: `ProductVariant.weight`

**Files:**
- Modify: `prisma/schema.prisma` (`ProductVariant` model, ~line 277-294)
- Modify: `src/modules/products/dto/product-variant.dto.ts`
- Modify: `src/modules/products/products.service.ts` (variant create ~line 316-334, `syncVariants` ~line 627-700, `toVariantDto` ~line 999-1009)

**Interfaces:**
- Produces: `ProductVariant.weight: number | null` (Prisma field, grams). `CreateProductVariantDto.weight: number` (required). `UpdateProductVariantDto.weight?: number` (optional — required only when the variant entry has no `id`, i.e. it's newly added during a product update).

- [ ] **Step 1: Add `weight` to the schema**

Edit `prisma/schema.prisma`, inside `model ProductVariant`:

```prisma
model ProductVariant {
  id            String  @id @default(cuid())
  productId     String
  size          String
  color         String
  sku           String  @unique
  price         Decimal @db.Decimal(12, 2)
  stockQuantity Int     @default(0)
  weight        Int? // gram — dùng tính phí ship GHN (backend-user), null = chưa nhập
  imageUrl      String?

  product        Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  cartItems      CartItem[]
  orderItems     OrderItem[]
  stockMovements StockMovement[]

  @@index([productId])
  @@map("product_variants")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm --filter @clothing-shop/be exec prisma migrate dev --name add_product_variant_weight`

Expected: a new folder under `prisma/migrations/<timestamp>_add_product_variant_weight/` containing `ALTER TABLE "product_variants" ADD COLUMN "weight" INTEGER;`. Nullable additive column — no data-loss prompt should appear.

- [ ] **Step 3: Add `weight` to the variant DTOs**

Edit `src/modules/products/dto/product-variant.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductVariantDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  size!: string;

  @ApiProperty({ example: 'Đen' })
  @IsString()
  color!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: 'Mặc định = basePrice nếu bỏ trống' })
  @IsOptional()
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiProperty({ description: 'Khối lượng (gram) — dùng tính phí ship GHN' })
  @IsInt()
  @Min(1)
  weight!: number;

  // string | null (không chỉ string) để UpdateProductVariantDto (kế thừa bên dưới) phân
  // biệt được "không đổi" (bỏ trống field) với "gỡ ảnh" (gửi null) — xem update-product.dto.ts
  // đã áp dụng cùng convention cho brandId/salePrice.
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

export class UpdateProductVariantDto extends CreateProductVariantDto {
  @ApiPropertyOptional({
    description: 'Có id => cập nhật variant hiện có; không có => tạo mới',
  })
  @IsOptional()
  @IsString()
  id?: string;

  // Ghi đè lại weight của lớp cha: chỉ bắt buộc khi ĐANG THÊM biến thể mới (không có id)
  // trong lúc sửa sản phẩm — biến thể đã có (có id) giữ nguyên weight cũ nếu admin không
  // gửi kèm, tránh chặn việc sửa giá/ảnh của biến thể cũ chưa kịp nhập khối lượng.
  @ApiPropertyOptional({
    description:
      'Khối lượng (gram) — bắt buộc khi thêm biến thể mới, tùy chọn khi sửa biến thể đã có',
  })
  @ValidateIf((dto: UpdateProductVariantDto) => !dto.id)
  @IsInt()
  @Min(1)
  weight!: number;
}
```

- [ ] **Step 4: Pass `weight` through on create**

In `src/modules/products/products.service.ts`, inside the `variantsData.push({...})` block (~line 326-333):

```ts
      variantsData.push({
        size: variant.size,
        color: variant.color,
        sku,
        price: variant.price ?? dto.basePrice,
        stockQuantity: variant.stockQuantity ?? 0,
        weight: variant.weight,
        imageUrl: variant.imageUrl,
      });
```

- [ ] **Step 5: Pass `weight` through in `syncVariants`**

In the same file, `syncVariants` update branch (~line 663-672, `item.id` truthy — keep old weight if not resent):

```ts
        await tx.productVariant.update({
          where: { id: item.id },
          data: {
            size: item.size,
            color: item.color,
            sku,
            price: item.price ?? basePrice,
            weight: item.weight ?? current.weight,
            imageUrl: item.imageUrl,
          },
        });
```

And the create branch (~line 683-693, no `id` — `item.weight` is guaranteed present by the DTO's `@ValidateIf`):

```ts
        const created = await tx.productVariant.create({
          data: {
            productId,
            size: item.size,
            color: item.color,
            sku,
            price: item.price ?? basePrice,
            stockQuantity: item.stockQuantity ?? 0,
            weight: item.weight,
            imageUrl: item.imageUrl,
          },
        });
```

- [ ] **Step 6: Return `weight` in the variant response**

In `toVariantDto` (~line 999-1009):

```ts
function toVariantDto(variant: ProductVariant) {
  return {
    id: variant.id,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    price: variant.price.toNumber(),
    stockQuantity: variant.stockQuantity,
    weight: variant.weight,
    imageUrl: variant.imageUrl,
  };
}
```

- [ ] **Step 7: Build and lint**

Run: `pnpm --filter @clothing-shop/be build`
Expected: PASS, no TS errors (Prisma Client now has `weight` on `ProductVariant` after Step 2's migrate regenerated it).

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/products/dto/product-variant.dto.ts src/modules/products/products.service.ts
git commit -m "feat(products): add weight to ProductVariant for GHN shipping fee calc"
```

---

### Task 2: `Address` → FK to `Province`/`District`/`Ward`

**Files:**
- Modify: `prisma/schema.prisma` (`Address`, `Province`, `District`, `Ward` models)

**Interfaces:**
- Produces: `Address.provinceId/districtId/wardId: string` (FK), `Address.province/district/ward` relations. Consumed by `backend-user`'s `addresses` and `shipping` modules after the submodule bump.

- [ ] **Step 1: Pre-flight — check for existing address data**

Run: `pnpm --filter @clothing-shop/be exec prisma studio` (or `psql` / any DB client) and check row count of the `addresses` table.

**This step has a decision point — do not proceed automatically:**
- If `addresses` has 0 rows (expected for the current dev DB, per the design spec's assumption): continue to Step 2.
- If `addresses` has rows: **stop and ask the user** how to handle the data (this plan does not attempt text→id backfill — see spec's rationale). Do not run a destructive migration over real data without explicit confirmation.

- [ ] **Step 2: Edit the schema**

Replace the `Address` model in `prisma/schema.prisma`:

```prisma
model Address {
  id           String  @id @default(cuid())
  userId       String
  receiverName String
  phone        String
  provinceId   String
  districtId   String
  wardId       String
  detail       String
  isDefault    Boolean @default(false)

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  province Province @relation(fields: [provinceId], references: [id])
  district District @relation(fields: [districtId], references: [id])
  ward     Ward     @relation(fields: [wardId], references: [id])

  @@index([userId])
  @@index([provinceId])
  @@index([districtId])
  @@index([wardId])
  @@map("addresses")
}
```

Add the reverse relations (Prisma requires both sides declared):

```prisma
model Province {
  id    String @id @default(cuid())
  ghnId Int    @unique
  name  String

  districts District[]
  addresses Address[]

  @@map("provinces")
}

model District {
  id         String @id @default(cuid())
  ghnId      Int    @unique
  provinceId String
  name       String

  province  Province @relation(fields: [provinceId], references: [id], onDelete: Cascade)
  wards     Ward[]
  addresses Address[]

  @@index([provinceId])
  @@map("districts")
}

model Ward {
  id         String @id @default(cuid())
  ghnCode    String @unique
  districtId String
  name       String

  district  District @relation(fields: [districtId], references: [id], onDelete: Cascade)
  addresses Address[]

  @@index([districtId])
  @@map("wards")
}
```

- [ ] **Step 3: Generate and apply the migration**

Run: `pnpm --filter @clothing-shop/be exec prisma migrate dev --name convert_address_to_location_fk`

If Step 1 confirmed 0 rows in `addresses`, Prisma should apply without a data-loss confirmation prompt. If it does prompt, stop and re-confirm with the user before typing `y` — do not accept data loss silently.

Expected migration SQL: drops `province`/`district`/`ward` text columns, adds `province_id`/`district_id`/`ward_id` columns with FK constraints to `provinces`/`districts`/`wards`.

- [ ] **Step 4: Build**

Run: `pnpm --filter @clothing-shop/be build`
Expected: PASS. (Already verified via grep that no service/seed in this repo references `Address.province/district/ward` — only the generated Prisma types change.)

Run: `pnpm --filter @clothing-shop/be lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(addresses): switch Address to FK references into Province/District/Ward"
```

---

## Handoff note for `backend-user`

Once both tasks are committed on `feature/ghn-shipping-schema`, `backend-user`'s plan (`2026-08-19-ghn-shipping-fee.md`) can bump its `vendor/backend-cms` submodule to this branch's HEAD commit to pick up both schema changes.

**Hard deployment constraint — read before deploying anywhere beyond local dev:**

- `convert_address_to_location_fk` adds 3 `NOT NULL` FK columns to `addresses` with no default. It will fail outright (and, per this repo's `start:prod` script, block the app from booting) against any `addresses` table that already has rows. The local dev DB's 22 pre-existing rows were wiped with explicit sign-off before this migration was applied here — **that decision does not transfer to any other environment.** Before applying this migration anywhere else (staging, shared DB, prod), first confirm whether `addresses` has rows there, and if so, get an explicit decision on how to handle them (wipe vs. some other resolution) before running `prisma migrate deploy` — do not let it run unattended against an environment that hasn't been checked.
- `backend-cms` and `backend-user` share one physical Postgres database (see `backend-user`'s README). `backend-user`'s `addresses` module still writes the OLD `province`/`district`/`ward` text columns until its own plan (`2026-08-19-ghn-shipping-fee.md`, Task 3) lands. **This migration and `backend-user`'s Task 3 must be deployed together, never independently** — applying this migration to a shared database ahead of `backend-user`'s update will break `backend-user`'s address create/update/list endpoints immediately (`42703 column "province" does not exist`).
