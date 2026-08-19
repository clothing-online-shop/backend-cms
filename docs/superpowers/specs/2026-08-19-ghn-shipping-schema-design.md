# Thiết kế: Schema hỗ trợ tính phí ship GHN

Ngày: 2026-08-19
Repo: backend-cms
Spec liên quan: [backend-user] `2026-08-19-ghn-shipping-fee-design.md` (đọc schema từ spec này qua submodule)

## Bối cảnh

`backend-user` cần tích hợp API GHN để: map địa chỉ hành chính sang mã GHN, tính phí ship theo địa chỉ + khối lượng đơn, trả về các gói cước + thời gian giao dự kiến. Schema dùng chung hiện thiếu 2 thứ:

1. `ProductVariant` không có field khối lượng (weight) — không tính được tổng khối lượng đơn.
2. `Address` lưu `province/district/ward` dạng text tự do, không liên kết tới bảng `Province/District/Ward` (đã đồng bộ sẵn từ GHN, có `ghnId`/`ghnCode`) — GHN cần `district_id`/`ward_code` dạng số/mã, không nhận tên tự do.

Repo này là nơi duy nhất sở hữu schema dùng chung (`prisma/schema.prisma`), nên 2 thay đổi trên phải làm ở đây trước, `backend-user` bump submodule sau (theo quy ước ở `CLAUDE.md`).

Phạm vi: chỉ đổi schema + DTO nhập liệu liên quan ở CMS. Không đụng tới logic tính phí thực tế (nằm ở `backend-user`), không tạo vận đơn GHN thật.

## Thay đổi schema

### 1. `ProductVariant.weight`

Thêm cột `weight Int?` (đơn vị: gram). Nullable ở DB vì variant hiện có (nếu có) chưa có dữ liệu, không ép giá trị giả. Field `@@map` giữ nguyên, không đổi tên bảng.

```prisma
model ProductVariant {
  id            String  @id @default(cuid())
  productId     String
  size          String
  color         String
  sku           String  @unique
  price         Decimal @db.Decimal(12, 2)
  stockQuantity Int     @default(0)
  weight        Int?    // gram — dùng tính phí ship GHN, null = chưa nhập
  imageUrl      String?
  ...
}
```

DTO `product-variant.dto.ts`: thêm field `weight` **required** (`@IsInt() @Min(1)`) cho variant tạo mới từ nay trở đi — admin bắt buộc nhập khi thêm variant mới qua CMS. Variant cũ (nếu có) giữ `null` cho tới khi admin sửa lại; không xây thêm công cụ rà soát riêng (YAGNI — `backend-user` tự báo lỗi rõ ràng khi thiếu weight lúc tính phí).

### 2. `Address` — đổi từ text sang FK

Thay 3 cột text bằng FK tới `Province/District/Ward`:

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
  @@map("addresses")
}
```

Thêm quan hệ ngược `addresses Address[]` vào `Province`, `District`, `Ward` (Prisma yêu cầu khai cả 2 chiều).

**Migration là destructive**: không cố match text `province/district/ward` cũ sang id (rủi ro sai lệch dấu/viết tắt tên tỉnh/quận, không đáng tin). Giả định DB hiện tại là môi trường dev, chưa có dữ liệu địa chỉ khách hàng thật cần giữ. Nếu giả định này sai (đã có dữ liệu thật cần bảo toàn), cần quay lại chọn hướng backfill thủ công trước khi chạy migration.

## Không thay đổi

- Không đụng `Order`/`OrderItem` — phí ship, mã vận đơn, ngày giao dự kiến chưa lưu vào Order ở spec này (nằm ngoài phạm vi, vì tạo đơn thật chưa implement).
- Không thêm endpoint/công cụ rà soát variant thiếu weight ở CMS.
- Không đổi `LocationsService`/`LocationsController` (sync GHN, đọc provinces/districts/wards cho admin) — giữ nguyên.

## Việc cần làm

1. Sửa `prisma/schema.prisma` theo trên.
2. `pnpm --filter @clothing-shop/be prisma:migrate` — tạo migration, kiểm tra chạy sạch từ đầu (theo yêu cầu ở `CLAUDE.md` trước khi mở PR).
3. Sửa `product-variant.dto.ts` (create + update variant) thêm field `weight`.
4. Rà `pnpm --filter @clothing-shop/be build` — không có chỗ nào trong repo này tham chiếu `Address.province/district/ward` hiện tại (đã kiểm tra: không seed, không service nào dùng), nên khả năng cao build qua ngay; vẫn chạy build để chắc chắn.
