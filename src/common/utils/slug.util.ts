import slugify from 'slugify';

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function generateSlug(input: string): string {
  return slugify(stripDiacritics(input), {
    lower: true,
    strict: true,
    trim: true,
  });
}

// Dùng riêng cho SKU (products.service.ts resolveUniqueSku()) — quy ước SKU trong app là
// IN HOA (FE tự uppercase lúc gõ/tự sinh, xem ProductVariantsStep.tsx), khác slug URL nên
// không dùng chung generateSlug() (luôn lowercase) kẻo SKU bị lowercase ngược lại sau khi
// lưu dù FE đã gửi lên đúng in hoa.
export function generateSku(input: string): string {
  return slugify(stripDiacritics(input), {
    lower: false,
    strict: true,
    trim: true,
  }).toUpperCase();
}
