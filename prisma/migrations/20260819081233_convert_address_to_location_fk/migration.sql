/*
  Warnings:

  - You are about to drop the column `district` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `province` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `ward` on the `addresses` table. All the data in the column will be lost.
  - Added the required column `districtId` to the `addresses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provinceId` to the `addresses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `wardId` to the `addresses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "addresses" DROP COLUMN "district",
DROP COLUMN "province",
DROP COLUMN "ward",
ADD COLUMN     "districtId" TEXT NOT NULL,
ADD COLUMN     "provinceId" TEXT NOT NULL,
ADD COLUMN     "wardId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "addresses_provinceId_idx" ON "addresses"("provinceId");

-- CreateIndex
CREATE INDEX "addresses_districtId_idx" ON "addresses"("districtId");

-- CreateIndex
CREATE INDEX "addresses_wardId_idx" ON "addresses"("wardId");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "wards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
