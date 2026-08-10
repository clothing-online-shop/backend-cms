// Mã lỗi cố định dạng số (không đổi theo ngôn ngữ hiển thị) để FE dựa vào `code` thay vì
// parse chuỗi `message` tiếng Việt — mỗi khi throw lỗi validate nghiệp vụ trong service
// (không tính lỗi tự động của class-validator), đính kèm 1 code ở đây (xem CLAUDE.md mục
// "Xử lý lỗi"). Mỗi domain giữ 1 dải 100 số để dễ mở rộng, thêm code mới vào cuối dải —
// không đổi/xoá giá trị code đã có vì FE có thể đã dựa vào để switch UI.
export enum ErrorCode {
  // Category (1001–1099)
  CATEGORY_NAME_DUPLICATE = 1001,
  CATEGORY_NAME_MATCHES_ANCESTOR = 1002,

  // Collection (1101–1199)
  COLLECTION_DELETE_BLOCKED_RUNNING = 1101,
  COLLECTION_START_DATE_IN_PAST = 1102,
  COLLECTION_UPDATE_FIELD_BLOCKED_RUNNING = 1103,
  COLLECTION_UPDATE_BLOCKED_ENDED = 1104,
  COLLECTION_ASSIGN_PRODUCTS_BLOCKED_ENDED = 1105,

  // Product (1201–1299)
  PRODUCT_NOT_FOUND = 1201,
  PRODUCT_CATEGORY_ID_REQUIRED = 1202,
  PRODUCT_DELETE_BLOCKED_VARIANT_IN_USE = 1203,
  PRODUCT_NOT_IN_COLLECTION = 1204,
  PRODUCT_VARIANT_NOT_FOUND = 1205,
  PRODUCT_VARIANT_DELETE_BLOCKED_IN_USE = 1206,
  PRODUCT_COLLECTION_NOT_FOUND = 1207,
  PRODUCT_CATEGORY_NOT_FOUND = 1208,
  PRODUCT_SALE_PRICE_INVALID = 1209,
  PRODUCT_VARIANT_DUPLICATE = 1210,
  PRODUCT_IMAGES_MISALIGNED = 1211,
  PRODUCT_COLLECTION_ENDED = 1212,
}
