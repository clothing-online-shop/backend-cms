-- Đổi tên cột thay vì drop+add để giữ nguyên dữ liệu subtitle hiện có (3 banner đang có giá
-- trị) — Prisma tự sinh DROP COLUMN "subtitle" + ADD COLUMN "description" nếu để tự động,
-- gây mất dữ liệu.
ALTER TABLE "banners" RENAME COLUMN "subtitle" TO "description";

-- AlterTable
ALTER TABLE "banners" ADD COLUMN "eyebrow" TEXT;
