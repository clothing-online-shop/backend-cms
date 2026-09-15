-- CreateTable
CREATE TABLE "mega_menu_promo_groups" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mega_menu_promo_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mega_menu_promo_links" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "mega_menu_promo_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mega_menu_looks" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imagePublicId" TEXT NOT NULL,
    "linkUrl" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mega_menu_looks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mega_menu_promo_groups_categoryId_idx" ON "mega_menu_promo_groups"("categoryId");

-- CreateIndex
CREATE INDEX "mega_menu_promo_links_groupId_idx" ON "mega_menu_promo_links"("groupId");

-- CreateIndex
CREATE INDEX "mega_menu_looks_categoryId_idx" ON "mega_menu_looks"("categoryId");

-- AddForeignKey
ALTER TABLE "mega_menu_promo_groups" ADD CONSTRAINT "mega_menu_promo_groups_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mega_menu_promo_links" ADD CONSTRAINT "mega_menu_promo_links_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "mega_menu_promo_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mega_menu_looks" ADD CONSTRAINT "mega_menu_looks_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
