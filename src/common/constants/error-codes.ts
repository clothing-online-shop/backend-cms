// Mỗi domain giữ 1 range 100 số riêng để dễ nhận diện qua giá trị số và tránh đụng nhau khi
// thêm code mới — domain nào chưa có code nào (Banner/Brand/Location/Order/Upload/User) vẫn
// giữ chỗ range dưới đây dù enum chưa có entry, để sau này thêm đúng theo đúng dải.
// Category 1001-1099 · Collection 1101-1199 · Product 1201-1299 · Inventory 1301-1399 ·
// Auth 1401-1499 · Banner 1501-1599 · Brand 1601-1699 · Location 1701-1799 ·
// Order (cms) 1801-1899 · Upload 1901-1999 · User 2001-2099
export const ErrorCode = {
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

  // Collection (1101-1199)
  COLLECTION_DELETE_BLOCKED_RUNNING: 1101,
  COLLECTION_START_DATE_IN_PAST: 1102,
  COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING: 1103,
  COLLECTION_UPDATE_BLOCKED_ENDED: 1104,
  COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED: 1105,
  COLLECTION_ASSIGN_BLOCKED_PRODUCT_INACTIVE: 1106,

  // Product (1201-1299)
  PRODUCT_NOT_IN_COLLECTION: 1204,
  PRODUCT_SALE_PRICE_INVALID: 1209,
  PRODUCT_COLLECTION_ENDED: 1212,

  // Inventory (1301-1399)
  INVENTORY_EXPORT_EXCEEDS_STOCK: 1301,
  INVENTORY_ADJUSTMENT_NO_CHANGE: 1302,

  // Auth (1401-1499)
  AUTH_INVALID_CREDENTIALS: 1401,
  AUTH_NOT_ADMIN: 1402,
  AUTH_ACCOUNT_DISABLED: 1403,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
