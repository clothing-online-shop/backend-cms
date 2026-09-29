-- Banner.startDate/endDate trở thành optional: bỏ trống = không giới hạn (thiếu startDate
-- coi như đã bắt đầu, thiếu endDate coi như không bao giờ kết thúc).
ALTER TABLE "banners" ALTER COLUMN "startDate" DROP NOT NULL;
ALTER TABLE "banners" ALTER COLUMN "endDate" DROP NOT NULL;
