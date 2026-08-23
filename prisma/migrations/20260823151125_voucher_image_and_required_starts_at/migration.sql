/*
  Warnings:

  - Made the column `startsAt` on table `vouchers` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "imagePublicId" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- Backfill dữ liệu cũ trước khi có ràng buộc bắt buộc chọn ngày bắt đầu — coi như voucher
-- đã có hiệu lực kể từ lúc tạo, không có mốc "ngày bắt đầu" nào khác đáng tin cậy hơn.
UPDATE "vouchers" SET "startsAt" = "createdAt" WHERE "startsAt" IS NULL;

ALTER TABLE "vouchers" ALTER COLUMN "startsAt" SET NOT NULL;
