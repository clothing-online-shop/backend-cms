-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hexCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colors_name_key" ON "colors"("name");

-- Seed bảng colors với bộ màu chuẩn TRƯỚC KHI thêm FK bên dưới — product_variants.color
-- hiện có (Đen, Trắng, Xám, Xanh, xem seed.ts) phải khớp sẵn trong bảng này thì FK mới
-- tạo được. Kèm theo 1 bảng màu phổ biến khác cho quần áo để admin có sẵn lựa chọn thay vì
-- phải tự thêm từng màu một trước khi tạo được sản phẩm.
INSERT INTO "colors" ("id", "name", "hexCode", "updatedAt") VALUES
  ('clr-den', 'Đen', '#1a1a1a', CURRENT_TIMESTAMP),
  ('clr-trang', 'Trắng', '#ffffff', CURRENT_TIMESTAMP),
  ('clr-xam', 'Xám', '#9c9691', CURRENT_TIMESTAMP),
  ('clr-ghi', 'Ghi', '#9c9691', CURRENT_TIMESTAMP),
  ('clr-xanh', 'Xanh', '#3b5fa0', CURRENT_TIMESTAMP),
  ('clr-xanh-duong', 'Xanh dương', '#3b5fa0', CURRENT_TIMESTAMP),
  ('clr-xanh-navy', 'Xanh navy', '#1f2d50', CURRENT_TIMESTAMP),
  ('clr-xanh-la', 'Xanh lá', '#4a7c4e', CURRENT_TIMESTAMP),
  ('clr-xanh-reu', 'Xanh rêu', '#6b7a4f', CURRENT_TIMESTAMP),
  ('clr-xanh-ngoc', 'Xanh ngọc', '#3f9c8a', CURRENT_TIMESTAMP),
  ('clr-xanh-khoi', 'Xanh khói', '#7a8b8c', CURRENT_TIMESTAMP),
  ('clr-nau', 'Nâu', '#8b5339', CURRENT_TIMESTAMP),
  ('clr-nau-dat', 'Nâu đất', '#6b4226', CURRENT_TIMESTAMP),
  ('clr-nau-nhat', 'Nâu nhạt', '#a97d5d', CURRENT_TIMESTAMP),
  ('clr-kem', 'Kem', '#f0e6d6', CURRENT_TIMESTAMP),
  ('clr-kem-nhat', 'Kem nhạt', '#f5ecdf', CURRENT_TIMESTAMP),
  ('clr-be', 'Be', '#e2d0c4', CURRENT_TIMESTAMP),
  ('clr-do', 'Đỏ', '#b3261e', CURRENT_TIMESTAMP),
  ('clr-do-do', 'Đỏ đô', '#6e1e28', CURRENT_TIMESTAMP),
  ('clr-hong', 'Hồng', '#e8b4bc', CURRENT_TIMESTAMP),
  ('clr-hong-nhat', 'Hồng nhạt', '#f2d3d8', CURRENT_TIMESTAMP),
  ('clr-vang', 'Vàng', '#e0b84b', CURRENT_TIMESTAMP),
  ('clr-vang-dong', 'Vàng đồng', '#b8860b', CURRENT_TIMESTAMP),
  ('clr-cam', 'Cam', '#d97b3f', CURRENT_TIMESTAMP),
  ('clr-cam-dat', 'Cam đất', '#b5622f', CURRENT_TIMESTAMP),
  ('clr-tim', 'Tím', '#7d5ba6', CURRENT_TIMESTAMP),
  ('clr-tim-than', 'Tím than', '#3d3358', CURRENT_TIMESTAMP),
  ('clr-bac', 'Bạc', '#c4c4c4', CURRENT_TIMESTAMP),
  ('clr-reu', 'Rêu', '#6b7a4f', CURRENT_TIMESTAMP);

-- Bất kỳ giá trị color nào còn tồn tại trong product_variants nhưng chưa có ở bảng seed cứng
-- phía trên (dữ liệu thật admin đã tự nhập trước khi có bảng colors) đều được backfill vào
-- đây với hexCode xám mặc định — đảm bảo FK bên dưới luôn tạo được bất kể data thực tế nào,
-- admin có thể sửa lại hexCode đúng sau qua API/màn quản lý màu.
INSERT INTO "colors" ("id", "name", "hexCode", "updatedAt")
SELECT gen_random_uuid()::text, pv."color", '#cccccc', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "color" FROM "product_variants") pv
WHERE NOT EXISTS (SELECT 1 FROM "colors" c WHERE c."name" = pv."color");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_color_fkey" FOREIGN KEY ("color") REFERENCES "colors"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
