// Trạng thái hiển thị cho admin — chỉ 2 giá trị theo yêu cầu, suy ra từ isActive VÀ
// startsAt/expiresAt/usageLimit (khác cột isActive trong DB, cột đó chỉ là 1 trong các yếu
// tố quyết định). ACTIVE = dùng được ngay bây giờ; mọi lý do khác (tắt tay, chưa tới ngày,
// đã hết hạn, đã hết lượt) đều gộp chung INACTIVE — chi tiết lý do vẫn xem được qua các cột
// riêng (thời hạn, lượt dùng) ở màn danh sách, không mất thông tin.
export enum VoucherStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
