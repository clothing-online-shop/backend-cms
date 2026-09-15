/*
  Warnings:

  - You are about to drop the column `megaMenuLeftLinkUrl` on the `categories` table. All the data in the column will be lost.
  - You are about to drop the column `megaMenuRightLinkUrl` on the `categories` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "categories" DROP COLUMN "megaMenuLeftLinkUrl",
DROP COLUMN "megaMenuRightLinkUrl";
