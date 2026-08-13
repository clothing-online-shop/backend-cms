/*
  Warnings:

  - Added the required column `endDate` to the `banners` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `banners` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `banners` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "banners" ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "imagePublicId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
