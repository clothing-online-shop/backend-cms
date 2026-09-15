import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateSlug } from '../src/common/utils/slug.util';
import { ProductStatus } from '../src/modules/products/product-status.enum';

const prisma = new PrismaClient();

const SIZES = ['S', 'M', 'L', 'XL'];
// Phải là tên đã có sẵn trong bảng colors (product_variants.color giờ là FK trỏ colors.name,
// xem schema.prisma + migration 20260908145301_add_color_table) — đổi/thêm màu ở đây thì
// phải thêm màu đó vào bảng colors trước (qua POST /colors hoặc thêm migration), nếu không
// prisma.product.upsert() bên dưới sẽ ném lỗi FK.
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
  // Phụ kiện (túi/khăn...) không có size quần áo — mặc định SIZES (S-XL) nếu bỏ trống.
  sizes?: string[];
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

  const sizes = seed.sizes ?? SIZES;
  const variantCount = Math.min(randomInt(2, 4), sizes.length * COLORS.length);
  const allCombos = sizes.flatMap((size) =>
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
    // categoryId luôn cập nhật (không chỉ lúc tạo mới) — cho phép taxonomy đổi cấu trúc
    // (vd gộp "Áo nam"/"Quần nam" cũ thành nhiều nhóm chi tiết hơn, xem
    // seedDetailedTaxonomy()) mà chạy lại seed vẫn tự chuyển đúng sản phẩm đã tồn tại sang
    // danh mục mới, không cần bước updateMany() riêng.
    update: { ...imageUpdate, categoryId: seed.categoryId },
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

// Phụ kiện (túi xách, khăn lụa) dùng size tự do thay vì S-XL của quần áo.
const FREESIZE = ['Freesize'];

interface TaxonomyLeafSeed {
  name: string;
  slug: string;
  // seedProduct() upsert theo slug sinh từ product.name — sản phẩm đã seed từ trước dưới
  // nhóm cấp 2 cũ ("Áo nam"/"Quần nam"/"Áo nữ"/"Váy nữ") chỉ cần giữ NGUYÊN tên cũ ở đây,
  // update() trong seedProduct() tự chuyển categoryId sang leaf mới khi chạy lại seed —
  // không cần bước reassign riêng, cũng không tạo trùng sản phẩm.
  product: { name: string; basePrice: number; sizes?: string[] };
}

interface TaxonomyGroupSeed {
  name: string;
  slug: string;
  leaves: TaxonomyLeafSeed[];
}

// Taxonomy chi tiết cho mega menu "Nữ" (thay cho 2 nhóm chung "Áo nữ"/"Váy nữ" cũ) — khớp
// đúng cấu trúc cột trong thiết kế mega menu mới: mỗi group là 1 danh mục cấp 2, mỗi leaf
// là 1 danh mục cấp 3 (Nữ > group > leaf = đúng giới hạn 3 cấp của cây danh mục).
const WOMEN_TAXONOMY: TaxonomyGroupSeed[] = [
  {
    name: 'Áo sơ mi',
    slug: 'ao-so-mi-nu',
    leaves: [
      { name: 'Sơ mi tay dài', slug: 'so-mi-tay-dai-nu', product: { name: 'Áo sơ mi nữ tay dài', basePrice: 249000 } },
      { name: 'Sơ mi hoa tiết', slug: 'so-mi-hoa-tiet-nu', product: { name: 'Áo sơ mi nữ hoạ tiết', basePrice: 269000 } },
      { name: 'Sơ mi tay ngắn', slug: 'so-mi-tay-ngan-nu', product: { name: 'Áo sơ mi nữ tay ngắn', basePrice: 229000 } },
      { name: 'Sơ mi kiểu', slug: 'so-mi-kieu-nu', product: { name: 'Áo kiểu nữ công sở', basePrice: 279000 } },
    ],
  },
  {
    name: 'Áo thun',
    slug: 'ao-thun-nu',
    leaves: [
      { name: 'Áo thun cổ tròn', slug: 'ao-thun-co-tron-nu', product: { name: 'Áo thun nữ croptop', basePrice: 149000 } },
      { name: 'Áo thun polo', slug: 'ao-thun-polo-nu', product: { name: 'Áo thun polo nữ', basePrice: 199000 } },
    ],
  },
  {
    name: 'Váy & Đầm',
    slug: 'vay-dam-nu',
    leaves: [
      { name: 'Đầm công sở', slug: 'dam-cong-so-nu', product: { name: 'Đầm công sở tay ngắn', basePrice: 389000 } },
      { name: 'Đầm form A', slug: 'dam-form-a-nu', product: { name: 'Váy maxi nữ đi biển', basePrice: 389000 } },
      { name: 'Đầm sơ mi', slug: 'dam-so-mi-nu', product: { name: 'Đầm sơ mi cổ V', basePrice: 359000 } },
      { name: 'Đầm xòe', slug: 'dam-xoe-nu', product: { name: 'Váy xòe nữ công sở', basePrice: 359000 } },
      { name: 'Đầm xếp ly', slug: 'dam-xep-ly-nu', product: { name: 'Đầm xếp ly eo cao', basePrice: 419000 } },
      { name: 'Đầm dự tiệc', slug: 'dam-du-tiec-nu', product: { name: 'Váy liền nữ dự tiệc', basePrice: 459000 } },
    ],
  },
  {
    name: 'Chân váy',
    slug: 'chan-vay-nu',
    leaves: [
      { name: 'Chân váy bút chì', slug: 'chan-vay-but-chi-nu', product: { name: 'Chân váy bút chì công sở', basePrice: 259000 } },
      { name: 'Chân váy xòe', slug: 'chan-vay-xoe-nu', product: { name: 'Chân váy xòe hoa nhí', basePrice: 249000 } },
      { name: 'Chân váy xếp ly', slug: 'chan-vay-xep-ly-nu', product: { name: 'Chân váy xếp ly ca rô', basePrice: 269000 } },
      { name: 'Chân váy chữ A', slug: 'chan-vay-chu-a-nu', product: { name: 'Chân váy nữ midi', basePrice: 259000 } },
    ],
  },
  {
    name: 'Quần dài',
    slug: 'quan-dai-nu',
    leaves: [
      { name: 'Quần âu ống suông', slug: 'quan-au-ong-suong-nu', product: { name: 'Quần âu nữ ống suông', basePrice: 329000 } },
      { name: 'Quần âu ống rộng', slug: 'quan-au-ong-rong-nu', product: { name: 'Quần âu nữ ống rộng', basePrice: 339000 } },
      { name: 'Quần âu ống đứng', slug: 'quan-au-ong-dung-nu', product: { name: 'Quần âu nữ ống đứng', basePrice: 319000 } },
      { name: 'Quần jeans', slug: 'quan-jean-nu-skinny', product: { name: 'Quần jean nữ skinny', basePrice: 359000 } },
    ],
  },
  {
    name: 'Áo khoác & Phụ kiện',
    slug: 'ao-khoac-phu-kien-nu',
    leaves: [
      { name: 'Áo khoác', slug: 'ao-khoac-nu', product: { name: 'Áo khoác nữ dạ', basePrice: 499000 } },
      { name: 'Blazer & Vest', slug: 'blazer-vest-nu', product: { name: 'Áo vest nữ blazer', basePrice: 549000 } },
      { name: 'Áo len & Cardigan', slug: 'ao-len-cardigan-nu', product: { name: 'Áo len nữ cổ lọ', basePrice: 329000 } },
      { name: 'Túi xách', slug: 'tui-xach-nu', product: { name: 'Túi xách nữ da trơn', basePrice: 459000, sizes: FREESIZE } },
      { name: 'Khăn lụa', slug: 'khan-lua-nu', product: { name: 'Khăn lụa nữ hoạ tiết', basePrice: 179000, sizes: FREESIZE } },
    ],
  },
];

// Taxonomy chi tiết cho mega menu "Nam" (thay cho 2 nhóm chung "Áo nam"/"Quần nam" cũ) — cùng
// tinh thần với WOMEN_TAXONOMY (6 nhóm cấp 2, mỗi nhóm vài leaf cấp 3), không có sẵn thiết kế
// riêng cho Nam nên tự đề xuất theo đúng nhịp cột đã dùng cho Nữ.
const MEN_TAXONOMY: TaxonomyGroupSeed[] = [
  {
    name: 'Áo sơ mi',
    slug: 'ao-so-mi-nam',
    leaves: [
      { name: 'Sơ mi trắng', slug: 'so-mi-trang-nam', product: { name: 'Áo sơ mi nam trắng', basePrice: 259000 } },
      { name: 'Sơ mi họa tiết', slug: 'so-mi-hoa-tiet-nam', product: { name: 'Áo sơ mi nam họa tiết', basePrice: 289000 } },
      { name: 'Sơ mi tay ngắn', slug: 'so-mi-tay-ngan-nam', product: { name: 'Áo sơ mi nam tay ngắn', basePrice: 239000 } },
      { name: 'Sơ mi kẻ sọc', slug: 'so-mi-ke-soc-nam', product: { name: 'Áo sơ mi nam kẻ sọc', basePrice: 259000 } },
    ],
  },
  {
    name: 'Áo thun',
    slug: 'ao-thun-nam',
    leaves: [
      { name: 'Áo thun cổ tròn', slug: 'ao-thun-co-tron-nam', product: { name: 'Áo thun nam basic', basePrice: 159000 } },
      { name: 'Áo thun polo', slug: 'ao-thun-polo-nam', product: { name: 'Áo polo nam', basePrice: 219000 } },
    ],
  },
  {
    name: 'Quần dài',
    slug: 'quan-dai-nam',
    leaves: [
      { name: 'Quần âu ống suông', slug: 'quan-au-ong-suong-nam', product: { name: 'Quần âu nam', basePrice: 349000 } },
      { name: 'Quần âu ống rộng', slug: 'quan-au-ong-rong-nam', product: { name: 'Quần âu nam ống rộng', basePrice: 359000 } },
      { name: 'Quần kaki dài', slug: 'quan-kaki-dai-nam', product: { name: 'Quần kaki nam dài', basePrice: 329000 } },
      { name: 'Quần jogger', slug: 'quan-jogger-nam', product: { name: 'Quần jogger nam', basePrice: 279000 } },
    ],
  },
  {
    name: 'Quần jean & Short',
    slug: 'quan-jean-short-nam',
    leaves: [
      { name: 'Quần jean slimfit', slug: 'quan-jean-slimfit-nam', product: { name: 'Quần jean nam slimfit', basePrice: 399000 } },
      { name: 'Quần jean ống suông', slug: 'quan-jean-ong-suong-nam', product: { name: 'Quần jean nam ống suông', basePrice: 379000 } },
      { name: 'Quần short kaki', slug: 'quan-short-kaki-nam', product: { name: 'Quần short nam kaki', basePrice: 229000 } },
      { name: 'Quần short jean', slug: 'quan-short-jean-nam', product: { name: 'Quần short jean nam', basePrice: 259000 } },
    ],
  },
  {
    name: 'Áo khoác & Vest',
    slug: 'ao-khoac-vest-nam',
    leaves: [
      { name: 'Áo khoác denim', slug: 'ao-khoac-denim-nam', product: { name: 'Áo khoác nam denim', basePrice: 459000 } },
      { name: 'Áo khoác bomber', slug: 'ao-khoac-bomber-nam', product: { name: 'Áo khoác bomber nam', basePrice: 499000 } },
      { name: 'Vest nam', slug: 'vest-nam', product: { name: 'Áo vest nam công sở', basePrice: 699000 } },
      { name: 'Áo len & Cardigan', slug: 'ao-len-cardigan-nam', product: { name: 'Áo len nam cổ tròn', basePrice: 329000 } },
    ],
  },
  {
    name: 'Phụ kiện',
    slug: 'phu-kien-nam',
    leaves: [
      { name: 'Thắt lưng', slug: 'that-lung-nam', product: { name: 'Thắt lưng nam da bò', basePrice: 259000, sizes: FREESIZE } },
      { name: 'Ví da', slug: 'vi-da-nam', product: { name: 'Ví da nam cầm tay', basePrice: 299000, sizes: FREESIZE } },
      { name: 'Mũ nón', slug: 'mu-non-nam', product: { name: 'Mũ lưỡi trai nam', basePrice: 149000, sizes: FREESIZE } },
      { name: 'Cà vạt', slug: 'ca-vat-nam', product: { name: 'Cà vạt nam họa tiết', basePrice: 189000, sizes: FREESIZE } },
    ],
  },
];

// Dùng chung cho cả Nam/Nữ — tạo taxonomy cấp 2/3 dưới `rootId`, tái sử dụng sản phẩm cũ theo
// tên hoặc seed sản phẩm mới cho leaf chưa có gì khớp, rồi xoá các danh mục cấp 2 cũ (đã
// chuyển hết sản phẩm sang taxonomy mới) trong `oldGroupSlugs`. `imageSeedStart` phải cách
// biệt giữa các lần gọi để không trùng ảnh placeholder.
async function seedDetailedTaxonomy(
  rootId: string,
  taxonomy: TaxonomyGroupSeed[],
  oldGroupSlugs: string[],
  imageSeedStart: number,
): Promise<void> {
  let imageSeedCounter = imageSeedStart;
  let groupSortOrder = 1;
  for (const group of taxonomy) {
    const groupCategory = await upsertCategory({
      name: group.name,
      slug: group.slug,
      parentId: rootId,
      sortOrder: groupSortOrder++,
    });

    let leafSortOrder = 1;
    for (const leaf of group.leaves) {
      const leafCategory = await upsertCategory({
        name: leaf.name,
        slug: leaf.slug,
        parentId: groupCategory.id,
        sortOrder: leafSortOrder++,
      });

      imageSeedCounter += 3;
      await seedProduct(
        {
          name: leaf.product.name,
          categoryId: leafCategory.id,
          basePrice: leaf.product.basePrice,
          sizes: leaf.product.sizes,
        },
        imageSeedCounter,
      );
    }
  }

  // Các danh mục cấp 2 cũ giờ đã chuyển hết sản phẩm sang taxonomy mới ở trên — xoá luôn cho
  // gọn cây danh mục. An toàn để chạy lại nhiều lần (không còn thì bỏ qua); nếu còn sản phẩm
  // nào chưa kịp chuyển thì FK sẽ chặn xoá (báo lỗi thay vì mất dữ liệu).
  await prisma.category.deleteMany({
    where: { slug: { in: oldGroupSlugs } },
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
  const nu = await upsertCategory({ name: 'Nữ', slug: 'nu', sortOrder: 2 });

  console.log('Seeding taxonomy chi tiết + sản phẩm mục Nam/Nữ (khớp thiết kế mega menu)...');
  // imageSeedStart cách biệt hẳn 2 dải để không trùng ảnh placeholder giữa Nam/Nữ.
  await seedDetailedTaxonomy(nam.id, MEN_TAXONOMY, ['ao-nam', 'quan-nam'], 500);
  await seedDetailedTaxonomy(nu.id, WOMEN_TAXONOMY, ['ao-nu', 'vay-nu'], 300);

  console.log('Seeding banners & popup trang chủ...');
  await seedHomepageContent();

  console.log('Seeding Flash Sale demo...');
  await seedFlashSale();

  console.log('Seeding bài viết (blog)...');
  await seedBlogPosts();

  console.log(
    `Đã seed xong: ${CMS_ACCOUNTS.length} tài khoản CMS, danh mục Nam/Nữ (cả 2 đều có taxonomy chi tiết theo mega menu), sản phẩm theo taxonomy, banner & popup trang chủ, Flash Sale demo, bài viết.`,
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
