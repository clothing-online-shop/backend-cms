export const CollectionErrorCode = {
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
} as const;
