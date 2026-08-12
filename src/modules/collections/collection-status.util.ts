// So sánh theo ngày lịch (bỏ qua giờ) — dùng chung giữa CollectionsService (tính status
// UPCOMING/RUNNING/ENDED) và ProductsService (chặn gán sản phẩm vào collection đã kết
// thúc), để 2 module không lệch nhau nếu quy tắc "thế nào là đã kết thúc" đổi sau này.
export function toDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isCollectionEnded(endDate: Date): boolean {
  return toDateOnly(new Date()) > toDateOnly(endDate);
}
