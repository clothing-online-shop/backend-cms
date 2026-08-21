// 1002 (CATEGORY_NAME_MATCHES_ANCESTOR) cố ý bỏ trống — BE chưa từng có validation "tên
// trùng tên tổ tiên", đây là tính năng chưa xây, không phải thiếu gán code. Giữ số 1002
// trống để dành nếu sau này tính năng đó được làm.
export const CategoryErrorCode = {
  CATEGORY_NAME_DUPLICATE: 1001,
  CATEGORY_DELETE_BLOCKED_HAS_CHILDREN: 1003,
  CATEGORY_SELF_PARENT: 1004,
  CATEGORY_REORDER_CYCLE: 1005,
  CATEGORY_MAX_DEPTH_EXCEEDED: 1006,
  CATEGORY_ANCESTOR_AS_PARENT: 1007,
  CATEGORY_NOT_FOUND: 1008,
  CATEGORY_DELETE_BLOCKED_HAS_PRODUCTS: 1009,
} as const;
