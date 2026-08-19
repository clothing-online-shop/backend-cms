// Dùng chung cho mọi API danh sách có phân trang (Product, Inventory, StockHistory,
// Customer...) — trước đây mỗi service tự viết lại y hệt phần tính skip/take và
// meta.totalPages, dễ lệch nhau khi 1 chỗ sửa mà quên sửa chỗ khác.
export function buildSkipTake(
  page: number,
  limit: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function buildPageMeta(
  total: number,
  page: number,
  limit: number,
): PageMeta {
  // Math.ceil(0 / limit) đã tự ra 0, không cần nhánh riêng cho total === 0.
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
