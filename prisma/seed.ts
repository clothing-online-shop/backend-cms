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

// picsum.photos/seed/<seed>/<w>/<h> trả cùng 1 ảnh cho cùng 1 seed (ổn định qua nhiều lần
// chạy seed, khác random hoàn toàn mỗi lần) — thay cho loremflickr.com (hay lỗi/chậm, đã bỏ
// khỏi toàn bộ codebase). Không hỗ trợ tìm theo từ khoá nội dung (không có ảnh "đúng thời
// trang") nhưng đổi lại ổn định, không phụ thuộc dịch vụ thứ 3 hay lỗi.
function picsumUrl(seed: string, width: number, height: number): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

async function seedProduct(
  seed: ProductSeed,
  imageSeed: number,
): Promise<void> {
  const slug = generateSlug(seed.name);
  const thumbnail = picsumUrl(`${slug}-0`, 600, 800);
  const images = [
    thumbnail,
    picsumUrl(`${slug}-1`, 600, 800),
    picsumUrl(`${slug}-2`, 600, 800),
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
    select: { thumbnailPublicId: true },
  });
  // Sản phẩm đã tồn tại nhưng thumbnailPublicId rỗng (các bản seed cũ trước khi field
  // này tồn tại) hoặc còn tiền tố "seed-placeholder/" — nghĩa là chưa từng bị admin thay
  // ảnh thật qua CMS (ảnh thật upload Cloudinary luôn có publicId dạng "clothing-shop/...")
  // — an toàn để ghi đè sang ảnh placeholder mới mỗi lần chạy seed. Ngược lại thì giữ
  // nguyên/tạo mới bình thường, không bao giờ ghi đè lên ảnh thật đã upload.
  const stillPlaceholder =
    !existing ||
    !existing.thumbnailPublicId ||
    existing.thumbnailPublicId.startsWith('seed-placeholder/');
  const imageUpdate = stillPlaceholder
    ? { thumbnail, thumbnailPublicId, images, imagePublicIds }
    : {};

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
          weight: randomInt(200, 1200),
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

  console.log('Seeding banners & popup trang chủ...');
  await seedHomepageContent();

  console.log('Seeding Flash Sale demo...');
  await seedFlashSale();

  console.log('Seeding bài viết (blog)...');
  await seedBlogPosts();

  console.log(
    `Đã seed xong: ${CMS_ACCOUNTS.length} tài khoản CMS, 6 danh mục, ${productSeeds.length} sản phẩm, banner & popup trang chủ, Flash Sale demo, bài viết.`,
  );
}

const BLOG_POST_SEEDS: { id: string; title: string; imageSeed: number }[] = [
  {
    id: 'seed-blog-1',
    title: 'Ba cách mặc sơ mi linen qua mùa chuyển gió',
    imageSeed: 920,
  },
  {
    id: 'seed-blog-2',
    title: 'Chọn size theo số đo, không theo cảm giác',
    imageSeed: 921,
  },
  {
    id: 'seed-blog-3',
    title: 'Bảo quản vải lụa pha để giữ đồ rũ',
    imageSeed: 922,
  },
];

async function seedBlogPosts(): Promise<void> {
  // Trang chủ sắp xếp bài viết theo createdAt desc — set createdAt lệch nhau vài giây theo
  // đúng thứ tự mảng ở trên (thay vì để mặc định @default(now()), dễ đảo thứ tự hiển thị nếu
  // seed chạy quá nhanh khiến nhiều bản ghi cùng 1 mốc thời gian).
  for (const [index, post] of BLOG_POST_SEEDS.entries()) {
    const createdAt = new Date(Date.now() - index * 1000);
    await prisma.blogPost.upsert({
      where: { id: post.id },
      update: {},
      create: {
        id: post.id,
        title: post.title,
        slug: generateSlug(post.title),
        content: `<p>${post.title}</p>`,
        coverImage: picsumUrl(`blog-${post.imageSeed}`, 800, 600),
        coverImagePublicId: `seed-placeholder/${post.imageSeed}`,
        isPublished: true,
        createdAt,
      },
    });
  }
}

// Idempotent theo tên — chạy lại seed nhiều lần không tạo thêm đợt Flash Sale trùng. Không
// dùng id cố định như Banner/Popup vì FlashSaleItem tham chiếu productVariantId có thể đổi
// giữa các lần seed lại catalog, nên để Prisma tự sinh id mới mỗi lần seed đợt này từ đầu.
async function seedFlashSale(): Promise<void> {
  const existing = await prisma.flashSale.findFirst({
    where: { name: 'Flash Sale Demo', isDelete: false },
  });
  if (existing) return;

  // Lấy 1 biến thể còn hàng của mỗi sản phẩm khác nhau (distinct theo productId) để mỗi thẻ
  // trên trang chủ ứng với 1 sản phẩm — tránh 2 item cùng productId đẩy vào cùng seedFlashSale.
  const variants = await prisma.productVariant.findMany({
    where: { stockQuantity: { gt: 0 } },
    orderBy: { id: 'asc' },
    distinct: ['productId'],
    take: 6,
  });
  if (variants.length === 0) return;

  await prisma.flashSale.create({
    data: {
      name: 'Flash Sale Demo',
      startDate: new Date(Date.now() - 60 * 60 * 1000),
      endDate: new Date(Date.now() + 6 * 60 * 60 * 1000),
      items: {
        create: variants.map((variant) => {
          const price = variant.price.toNumber();
          const salePrice = Math.round((price * 0.6) / 1000) * 1000;
          const quantityLimit = Math.min(variant.stockQuantity, randomInt(10, 30));
          return {
            productVariantId: variant.id,
            salePrice,
            quantityLimit,
            soldCount: randomInt(0, quantityLimit),
          };
        }),
      },
    },
  });
}

// id cố định (thay vì cuid tự sinh) để seed chạy lại nhiều lần vẫn upsert đúng vào cùng
// 1 bản ghi thay vì tạo trùng — Banner/Popup không có field nào khác unique để upsert theo.
const HOME_BANNER_SEEDS: {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaLinkUrl: string;
  imageSeed: number;
}[] = [
  {
    id: 'seed-banner-1',
    title: 'Trạm Hè Đa Sắc — Together Station',
    description: 'Bộ sưu tập Thu 2026 — lớp vải nhẹ cho ngày trở gió',
    ctaLabel: 'Xem thêm',
    ctaLinkUrl: '/san-pham',
    imageSeed: 901,
  },
  {
    id: 'seed-banner-2',
    title: 'Back To School',
    description: '42 mẫu mới, đủ size S–XL',
    ctaLabel: 'Xem thêm',
    ctaLinkUrl: '/san-pham',
    imageSeed: 902,
  },
  {
    id: 'seed-banner-3',
    title: 'Happy Week',
    description: 'Ưu đãi tới 50% toàn bộ sản phẩm',
    ctaLabel: 'Xem thêm',
    ctaLinkUrl: '/san-pham',
    imageSeed: 903,
  },
];

async function seedHomepageContent(): Promise<void> {
  // Khoảng ngày trượt theo thời điểm chạy seed (không hardcode) — luôn RUNNING dù seed
  // chạy vào lúc nào.
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  for (const [index, banner] of HOME_BANNER_SEEDS.entries()) {
    const imageUrl = picsumUrl(`banner-${banner.imageSeed}`, 1600, 900);
    const imagePublicId = `seed-placeholder/${banner.imageSeed}`;
    await prisma.banner.upsert({
      where: { id: banner.id },
      update: {},
      create: {
        id: banner.id,
        title: banner.title,
        description: banner.description,
        imageUrl,
        imagePublicId,
        linkUrl: '/san-pham',
        ctaLabel: banner.ctaLabel,
        ctaLinkUrl: banner.ctaLinkUrl,
        sortOrder: index,
        startDate,
        endDate,
      },
    });
  }

  await prisma.popup.upsert({
    where: { id: 'seed-popup-1' },
    update: {},
    create: {
      id: 'seed-popup-1',
      eyebrow: 'ƯU ĐÃI THÁNG 8',
      title: 'Giảm 15% đơn từ 800.000đ',
      description: 'Nhập mã THU26 ở bước thanh toán, hạn dùng đến 31.08.2026.',
      discountCode: 'THU26',
      imageUrl: picsumUrl('popup-910', 900, 1100),
      imagePublicId: 'seed-placeholder/910',
      ctaLabel: 'Mua sắm ngay',
      ctaLinkUrl: '/san-pham',
      sortOrder: 0,
      startDate,
      endDate,
    },
  });

  await prisma.promoBar.upsert({
    where: { id: 'seed-promo-bar-1' },
    update: {},
    create: {
      id: 'seed-promo-bar-1',
      label: 'Thu 2026',
      highlight: 'Giảm 30 – 50%',
      linkUrl: '/san-pham',
      sortOrder: 0,
      startDate,
      endDate,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
