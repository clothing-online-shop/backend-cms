export const ProductErrorCode = {
  PRODUCT_NOT_FOUND: 1201,
  PRODUCT_CATEGORY_ID_REQUIRED: 1202,
  PRODUCT_NOT_IN_COLLECTION: 1204,
  PRODUCT_VARIANT_NOT_FOUND: 1205,
  PRODUCT_VARIANT_DELETE_BLOCKED_IN_USE: 1206,
  PRODUCT_COLLECTION_NOT_FOUND: 1207,
  PRODUCT_CATEGORY_NOT_FOUND: 1208,
  PRODUCT_SALE_PRICE_INVALID: 1209,
  PRODUCT_VARIANT_DUPLICATE: 1210,
  // Dùng chung cho cả gán lẫn gỡ sản phẩm khỏi bộ sưu tập đã kết thúc — cùng 1 nghĩa
  // ("bộ sưu tập đã kết thúc"), message cụ thể khác nhau theo hành động (gán/gỡ) nằm ở
  // service, không phải ở đây.
  PRODUCT_COLLECTION_ENDED: 1212,
  PRODUCT_FEATURED_BLOCKED_NOT_ACTIVE: 1213,
} as const;
