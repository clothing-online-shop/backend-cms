import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

// So sánh theo ngày lịch (bỏ qua giờ) — dùng chung giữa nhiều module có khái niệm
// "ngày bắt đầu/kết thúc" (Collection, Banner...), để không lệch nhau nếu quy tắc
// "coi ngày nào là đã tới/đã qua" đổi sau này.
export function toDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Dùng chung giữa Collection và Banner (2 model duy nhất có cặp startDate/endDate) —
// trước đây mỗi module tự viết 1 bản y hệt.
export function assertDateRange(startDate: string, endDate: string): void {
  if (new Date(endDate) < new Date(startDate)) {
    throw new BadRequestException({
      message: 'Ngày kết thúc phải sau ngày bắt đầu.',
      code: ErrorCode.COMMON_DATE_RANGE_INVALID,
    });
  }
}

export type DateRangeStatus = 'UPCOMING' | 'RUNNING' | 'ENDED';

// Dùng chung giữa Collection và Banner để suy ra trạng thái UPCOMING/RUNNING/ENDED từ
// startDate/endDate so với "hôm nay" — trước đây mỗi module tự viết 1 bản `withStatus()` y
// hệt nhau. Trả literal union thay vì enum vì 2 module khai enum riêng
// (BannerStatus/CollectionStatus) theo đúng rule "enum gắn 1 model thì để trong module đó" —
// value trùng nhau nên caller ép kiểu (`as BannerStatus`) an toàn ở nơi gọi.
export function deriveDateRangeStatus(
  startDate: Date,
  endDate: Date,
): DateRangeStatus {
  const today = toDateOnly(new Date());
  if (today < toDateOnly(startDate)) return 'UPCOMING';
  if (today > toDateOnly(endDate)) return 'ENDED';
  return 'RUNNING';
}

// Riêng phần "đã kết thúc chưa" — dùng ở những chỗ chỉ cần biết true/false (vd chặn gán sản
// phẩm vào collection đã ENDED), không cần phân biệt UPCOMING/RUNNING.
export function isDateRangeEnded(endDate: Date): boolean {
  return toDateOnly(new Date()) > toDateOnly(endDate);
}
