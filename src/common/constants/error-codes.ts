// Mỗi domain giữ 1 range 100 số riêng để dễ nhận diện qua giá trị số và tránh đụng nhau khi
// thêm code mới. Toàn bộ exception BE tự throw tay (BadRequest/Conflict/NotFound/
// Unauthorized/Forbidden trong service/controller/guard) đều có code riêng — kể cả trường
// hợp generic ("không tìm thấy X") hoặc message có chèn giá trị động (id/sku/size/màu...).
// Nhiều throw site cùng 1 ý nghĩa nghiệp vụ (vd "không tìm thấy danh mục" ở nhiều hàm khác
// nhau trong categories.service.ts) dùng CHUNG 1 code, không tách riêng vô nghĩa.
// Không áp dụng cho lỗi validate DTO tự động (class-validator) — đó là lỗi field-level tự
// sinh, không phải logic nghiệp vụ BE viết tay.
// Common (shared util) 1-99 · Category 1001-1099 · Collection 1101-1199 · Product
// 1201-1299 · Inventory 1301-1399 · Auth 1401-1499 · Banner 1501-1599 · Brand 1601-1699 ·
// Location 1701-1799 · Order (cms) 1801-1899 · Upload 1901-1999 · User 2001-2099
export const ErrorCode = {
  // Common — dùng chung nhiều module qua common/utils (1-99)
  COMMON_IMAGE_PUBLIC_ID_MISMATCH: 1,
  COMMON_IMAGES_COUNT_MISMATCH: 2,
  COMMON_DATE_RANGE_INVALID: 3,

  // Category (1001-1099)
  CATEGORY_NAME_DUPLICATE: 1001,
  // 1002 (CATEGORY_NAME_MATCHES_ANCESTOR) cố ý bỏ trống — FE từng định nghĩa code này nhưng
  // BE chưa từng có validation "tên trùng tên tổ tiên", đây là tính năng chưa xây, không phải
  // thiếu gán code. Giữ số 1002 trống để dành nếu sau này tính năng đó được làm.
  CATEGORY_DELETE_BLOCKED_HAS_CHILDREN: 1003,
  CATEGORY_SELF_PARENT: 1004,
  CATEGORY_REORDER_CYCLE: 1005,
  CATEGORY_MAX_DEPTH_EXCEEDED: 1006,
  CATEGORY_ANCESTOR_AS_PARENT: 1007,
  CATEGORY_NOT_FOUND: 1008,
  CATEGORY_DELETE_BLOCKED_HAS_PRODUCTS: 1009,

  // Collection (1101-1199)
  COLLECTION_DELETE_BLOCKED_RUNNING: 1101,
  COLLECTION_START_DATE_IN_PAST: 1102,
  COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING: 1103,
  COLLECTION_UPDATE_BLOCKED_ENDED: 1104,
  COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED: 1105,
  // Dùng chung ở cả collections.service.ts (gán sản phẩm vào bộ sưu tập) lẫn
  // products.service.ts (gán bộ sưu tập cho sản phẩm) — 2 chiều của cùng 1 rule.
  COLLECTION_ASSIGN_BLOCKED_PRODUCT_INACTIVE: 1106,
  // Dùng chung ở cả collections.service.ts lẫn products.service.ts (kiểm tra collection tồn
  // tại trước khi gỡ sản phẩm) — cùng 1 entity, cùng 1 ý nghĩa "không tìm thấy".
  COLLECTION_NOT_FOUND: 1107,
  COLLECTION_ASSIGN_PRODUCTS_NOT_FOUND: 1108,

  // Product (1201-1299)
  PRODUCT_NOT_FOUND: 1201,
  PRODUCT_CATEGORY_ID_REQUIRED: 1202,
  PRODUCT_NOT_IN_COLLECTION: 1204,
  PRODUCT_VARIANT_NOT_FOUND: 1205,
  PRODUCT_VARIANT_DELETE_BLOCKED_IN_USE: 1206,
  PRODUCT_COLLECTION_NOT_FOUND: 1207,
  PRODUCT_CATEGORY_NOT_FOUND: 1208,
  PRODUCT_SALE_PRICE_INVALID: 1209,
  PRODUCT_VARIANT_DUPLICATE: 1210,
  PRODUCT_COLLECTION_ENDED: 1212,
  PRODUCT_FEATURED_BLOCKED_NOT_ACTIVE: 1213,

  // Inventory (1301-1399)
  INVENTORY_EXPORT_EXCEEDS_STOCK: 1301,
  INVENTORY_ADJUSTMENT_NO_CHANGE: 1302,
  INVENTORY_VARIANT_NOT_FOUND: 1303,

  // Auth (1401-1499)
  AUTH_INVALID_CREDENTIALS: 1401,
  AUTH_NOT_ADMIN: 1402,
  AUTH_ACCOUNT_DISABLED: 1403,
  AUTH_REFRESH_TOKEN_INVALID: 1404,
  AUTH_REFRESH_USER_NOT_FOUND: 1405,
  // Ném ở guard (jwt-auth.guard.ts/roles.guard.ts), không phải service — nhưng vẫn là
  // exception BE tự throw tay với message cụ thể, không phải lỗi framework mặc định.
  AUTH_SESSION_EXPIRED: 1406,
  AUTH_FORBIDDEN_ROLE: 1407,

  // Banner (1501-1599)
  BANNER_REORDER_NOT_FOUND: 1501,
  BANNER_NOT_FOUND: 1502,

  // Brand (1601-1699)
  BRAND_NOT_FOUND: 1601,
  BRAND_DELETE_BLOCKED_HAS_PRODUCTS: 1602,

  // Location (1701-1799)
  LOCATION_PROVINCE_NOT_FOUND: 1701,
  LOCATION_DISTRICT_NOT_FOUND: 1702,

  // Upload (1901-1999)
  UPLOAD_INVALID_PUBLIC_ID: 1901,
  UPLOAD_IMAGE_FILE_REQUIRED: 1902,
  UPLOAD_VIDEO_FILE_REQUIRED: 1903,
  UPLOAD_IMAGE_INVALID_TYPE: 1904,
  UPLOAD_VIDEO_INVALID_TYPE: 1905,

  // User (2001-2099)
  USER_CUSTOMER_NOT_FOUND: 2001,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
