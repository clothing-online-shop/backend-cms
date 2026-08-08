import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateSlug } from '../src/common/utils/slug.util';
import { ProductStatus } from '../src/modules/products/product-status.enum';

const prisma = new PrismaClient();

const SIZES = ['S', 'M', 'L', 'XL'];
const COLORS = ['Đen', 'Trắng', 'Xanh'];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: T[], count: number): T[] {
  return [...items].sort(() => Math.random() - 0.5).slice(0, count);
}

interface CategorySeed {
  name: string;
  slug: string;
  parentId?: string;
  sortOrder: number;
}

async function upsertCategory(data: CategorySeed) {
  return prisma.category.upsert({
    where: { slug: data.slug },
    update: {},
    create: data,
  });
}

interface ProductSeed {
  name: string;
  categoryId: string;
  basePrice: number;
}

async function seedProduct(
  seed: ProductSeed,
  imageSeed: number,
): Promise<void> {
  const slug = generateSlug(seed.name);
  const thumbnail = `https://picsum.photos/seed/${imageSeed}/600/800`;
  const images = [
    thumbnail,
    `https://picsum.photos/seed/${imageSeed + 1}/600/800`,
    `https://picsum.photos/seed/${imageSeed + 2}/600/800`,
  ];
  // Ảnh seed không phải upload Cloudinary thật nên không có publicId thật — vẫn phải
  // set song song đủ số lượng với `images`, nếu không CMS sẽ báo lỗi lệch mảng khi admin
  // sửa lại sản phẩm seed (xem assertImagesPublicIdsAligned ở products.service.ts).
  const thumbnailPublicId = `seed-placeholder/${imageSeed}`;
  const imagePublicIds = images.map(
    (_, i) => `seed-placeholder/${imageSeed + i}`,
  );

  const variantCount = randomInt(2, 4);
  const allCombos = SIZES.flatMap((size) =>
    COLORS.map((color) => ({ size, color })),
  );
  const combos = pickRandom(allCombos, variantCount);

  const existing = await prisma.product.findUnique({
    where: { slug },
    select: { images: true, imagePublicIds: true },
  });
  // Sản phẩm đã tồn tại và imagePublicIds đã khớp đủ số lượng với images hiện có (vd
  // admin đã tự upload ảnh thật qua CMS, thay cho ảnh placeholder ban đầu) — không đụng
  // lại thumbnail/images nữa, tránh chạy lại seed làm mất ảnh thật đã upload. Chỉ backfill
  // publicId placeholder khớp đúng số lượng ảnh HIỆN CÓ khi thật sự còn thiếu.
  const imageUpdate =
    existing && existing.imagePublicIds.length === existing.images.length
      ? {}
      : {
          thumbnailPublicId,
          imagePublicIds: (existing?.images ?? images).map(
            (_, i) => `seed-placeholder/${imageSeed + i}`,
          ),
        };

  await prisma.product.upsert({
    where: { slug },
    update: imageUpdate,
    create: {
      name: seed.name,
      slug,
      description: `${seed.name} chất liệu cao cấp, form dáng chuẩn, dễ phối đồ, phù hợp nhiều dịp trong ngày.`,
      categoryId: seed.categoryId,
      basePrice: seed.basePrice,
      status: ProductStatus.ACTIVE,
      thumbnail,
      thumbnailPublicId,
      images,
      imagePublicIds,
      variants: {
        create: combos.map(({ size, color }) => ({
          size,
          color,
          sku: generateSlug(`${slug}-${size}-${color}`).toUpperCase(),
          price: Math.max(seed.basePrice + randomInt(-10, 10) * 1000, 10000),
          stockQuantity: randomInt(0, 60),
          imageUrl: thumbnail,
        })),
      },
    },
  });
}

const CMS_ACCOUNTS: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}[] = [
  {
    email: 'admin@clothing-shop.com',
    password: 'admin123',
    fullName: 'Quản trị viên',
    role: 'ADMIN',
  },
  {
    email: 'warehouse@clothing-shop.com',
    password: 'warehouse123',
    fullName: 'Nhân viên kho',
    role: 'WAREHOUSE_STAFF',
  },
  {
    email: 'marketing@clothing-shop.com',
    password: 'marketing123',
    fullName: 'Nhân viên marketing',
    role: 'MARKETING',
  },
];

async function main() {
  console.log('Seeding CMS accounts (ADMIN, WAREHOUSE_STAFF, MARKETING)...');
  for (const account of CMS_ACCOUNTS) {
    const passwordHash = await argon2.hash(account.password);
    await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        password: passwordHash,
        fullName: account.fullName,
        role: account.role,
      },
    });
  }

  console.log('Seeding categories...');
  const nam = await upsertCategory({ name: 'Nam', slug: 'nam', sortOrder: 1 });
  const aoNam = await upsertCategory({
    name: 'Áo nam',
    slug: 'ao-nam',
    parentId: nam.id,
    sortOrder: 1,
  });
  const quanNam = await upsertCategory({
    name: 'Quần nam',
    slug: 'quan-nam',
    parentId: nam.id,
    sortOrder: 2,
  });
  const nu = await upsertCategory({ name: 'Nữ', slug: 'nu', sortOrder: 2 });
  const aoNu = await upsertCategory({
    name: 'Áo nữ',
    slug: 'ao-nu',
    parentId: nu.id,
    sortOrder: 1,
  });
  const vayNu = await upsertCategory({
    name: 'Váy nữ',
    slug: 'vay-nu',
    parentId: nu.id,
    sortOrder: 2,
  });

  console.log('Seeding products...');
  const productSeeds: ProductSeed[] = [
    { name: 'Áo sơ mi nam trắng', categoryId: aoNam.id, basePrice: 259000 },
    { name: 'Áo thun nam basic', categoryId: aoNam.id, basePrice: 159000 },
    { name: 'Áo polo nam', categoryId: aoNam.id, basePrice: 219000 },
    { name: 'Áo khoác nam denim', categoryId: aoNam.id, basePrice: 459000 },
    {
      name: 'Quần jean nam slimfit',
      categoryId: quanNam.id,
      basePrice: 399000,
    },
    { name: 'Quần âu nam', categoryId: quanNam.id, basePrice: 349000 },
    { name: 'Quần short nam kaki', categoryId: quanNam.id, basePrice: 229000 },
    { name: 'Quần jogger nam', categoryId: quanNam.id, basePrice: 279000 },
    { name: 'Áo sơ mi nữ tay dài', categoryId: aoNu.id, basePrice: 249000 },
    { name: 'Áo thun nữ croptop', categoryId: aoNu.id, basePrice: 149000 },
    { name: 'Áo kiểu nữ công sở', categoryId: aoNu.id, basePrice: 279000 },
    { name: 'Áo len nữ cổ lọ', categoryId: aoNu.id, basePrice: 329000 },
    { name: 'Áo khoác nữ dạ', categoryId: aoNu.id, basePrice: 499000 },
    { name: 'Áo vest nữ blazer', categoryId: aoNu.id, basePrice: 549000 },
    { name: 'Váy liền nữ dự tiệc', categoryId: vayNu.id, basePrice: 459000 },
    { name: 'Váy xòe nữ công sở', categoryId: vayNu.id, basePrice: 359000 },
    { name: 'Chân váy nữ midi', categoryId: vayNu.id, basePrice: 259000 },
    { name: 'Váy maxi nữ đi biển', categoryId: vayNu.id, basePrice: 389000 },
  ];

  for (const [index, seed] of productSeeds.entries()) {
    await seedProduct(seed, 100 + index * 3);
  }

  console.log(
    `Đã seed xong: ${CMS_ACCOUNTS.length} tài khoản CMS, 6 danh mục, ${productSeeds.length} sản phẩm.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
