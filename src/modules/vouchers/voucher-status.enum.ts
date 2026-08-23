// Trạng thái hiển thị cho admin, suy ra từ isActive/startsAt/expiresAt/usageLimit — không
// phải cột lưu trong DB (khác isActive, cột đó chỉ là 1 trong các yếu tố quyết định trạng
// thái hiển thị này).
export enum VoucherStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  UPCOMING = 'UPCOMING',
  EXPIRED = 'EXPIRED',
  OUT_OF_USAGE = 'OUT_OF_USAGE',
}
