// Trạng thái hiển thị cho admin — chỉ 2 giá trị theo yêu cầu, suy ra từ isActive VÀ
// startsAt/expiresAt/usageLimit (khác cột isActive trong DB, cột đó chỉ là 1 trong các yếu
// tố quyết định). ACTIVE = dùng được ngay bây giờ; mọi lý do khác (tắt tay, chưa tới ngày,
// đã hết hạn, đã hết lượt) đều gộp chung INACTIVE — chi tiết lý do vẫn xem được qua các cột
// riêng (thời hạn, lượt dùng) ở màn danh sách, không mất thông tin.
// Lưu dạng số (không phải string) — khớp quy ước ProductStatus (product-status.enum.ts),
// không phải cột lưu trong DB nên không có ràng buộc gì từ phía Postgres, chỉ là lựa chọn
// nhất quán về kiểu dữ liệu giữa các enum trạng thái trong codebase.
export enum VoucherStatus {
  INACTIVE = 0,
  ACTIVE = 1,
}
