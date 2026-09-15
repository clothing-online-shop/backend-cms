/*
  Warnings:

  - You are about to drop the `mega_menu_looks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mega_menu_promo_groups` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mega_menu_promo_links` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "mega_menu_looks" DROP CONSTRAINT "mega_menu_looks_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "mega_menu_promo_groups" DROP CONSTRAINT "mega_menu_promo_groups_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "mega_menu_promo_links" DROP CONSTRAINT "mega_menu_promo_links_groupId_fkey";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "megaMenuLeftImagePublicId" TEXT,
ADD COLUMN     "megaMenuLeftImageUrl" TEXT,
ADD COLUMN     "megaMenuLeftLinkUrl" TEXT,
ADD COLUMN     "megaMenuRightImagePublicId" TEXT,
ADD COLUMN     "megaMenuRightImageUrl" TEXT,
ADD COLUMN     "megaMenuRightLinkUrl" TEXT,
ADD COLUMN     "showInNewArrivals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showInSaleCorner" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "mega_menu_looks";

-- DropTable
DROP TABLE "mega_menu_promo_groups";

-- DropTable
DROP TABLE "mega_menu_promo_links";
