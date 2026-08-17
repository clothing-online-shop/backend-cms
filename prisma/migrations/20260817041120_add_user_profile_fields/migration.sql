-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarPublicId" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);
