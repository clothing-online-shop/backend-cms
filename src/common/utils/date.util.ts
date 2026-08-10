// So sánh theo ngày lịch (bỏ qua giờ) — dùng chung cho mọi chỗ cần biết "hôm nay" so với
// 1 mốc ngày mà không bị lệch theo giờ trong ngày (VD collection kết thúc "hôm nay" vẫn
// coi là RUNNING tới hết ngày, không rơi sang ENDED ngay từ 00:00). Dùng ở cả
// collections.service.ts (tính CollectionStatus) và products.service.ts (chặn gán sản
// phẩm vào bộ sưu tập đã kết thúc) — tách ra đây để 2 chỗ luôn tính nhất quán.
export function toDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
