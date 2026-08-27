import { CommonErrorCode } from './common';
import { CategoryErrorCode } from './category';
import { CollectionErrorCode } from './collection';
import { ProductErrorCode } from './product';
import { InventoryErrorCode } from './inventory';
import { AuthErrorCode } from './auth';
import { BannerErrorCode } from './banner';
import { BrandErrorCode } from './brand';
import { LocationErrorCode } from './location';
import { OrderErrorCode } from './order';
import { UploadErrorCode } from './upload';
import { UserErrorCode } from './user';
import { VoucherErrorCode } from './voucher';
import { FlashSaleErrorCode } from './flash-sale';

// Toàn bộ exception BE tự throw tay (BadRequest/Conflict/NotFound/Unauthorized/Forbidden
// trong service/controller/guard) đều có code riêng — kể cả trường hợp generic ("không tìm
// thấy X") hoặc message có chèn giá trị động (id/sku/size/màu...). Không áp dụng cho lỗi
// validate DTO tự động (class-validator) — đó là lỗi field-level tự sinh, không phải logic
// nghiệp vụ BE viết tay.
//
// Mỗi domain khai báo trong 1 file riêng cùng thư mục này (category.ts, product.ts...) —
// file này chỉ gộp lại thành 1 ErrorCode duy nhất, KHÔNG khai báo trực tiếp code nào ở đây.
// Thêm code mới cho module nào thì sửa đúng file domain đó, không sửa file này (trừ khi
// thêm hẳn 1 domain mới).
//
// Mỗi domain giữ 1 range 100 số riêng để dễ nhận diện qua giá trị số và tránh đụng nhau:
// Common (shared util) 1-99 · Category 1001-1099 · Collection 1101-1199 · Product
// 1201-1299 · Inventory 1301-1399 · Auth 1401-1499 · Banner 1501-1599 · Brand 1601-1699 ·
// Location 1701-1799 · Order (cms) 1801-1899 · Upload 1901-1999 · User 2001-2099 ·
// Voucher 2101-2199 · Flash Sale 2201-2299
export const ErrorCode = {
  ...CommonErrorCode,
  ...CategoryErrorCode,
  ...CollectionErrorCode,
  ...ProductErrorCode,
  ...InventoryErrorCode,
  ...AuthErrorCode,
  ...BannerErrorCode,
  ...BrandErrorCode,
  ...LocationErrorCode,
  ...OrderErrorCode,
  ...UploadErrorCode,
  ...UserErrorCode,
  ...VoucherErrorCode,
  ...FlashSaleErrorCode,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
