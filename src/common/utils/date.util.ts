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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Khớp hậu tố "Z" hoặc "+07:00"/"-05:00" ở cuối chuỗi — chuỗi đã tự mang múi giờ thì giữ
// nguyên, không gán đè lên.
const HAS_TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/;

// Cả 2 hàm bên dưới đều CỐ Ý neo theo giờ Việt Nam (UTC+7) một cách tường minh (không dựa
// vào múi giờ hệ điều hành/`new Date()` mặc định) — admin nhập ngày theo lịch VN
// (OrderList.tsx/InventoryHistory.tsx), nếu server chạy production không đặt biến môi
// trường TZ=Asia/Ho_Chi_Minh (mặc định nhiều host container/Render là UTC) thì hành vi cũ
// (không có hậu tố múi giờ) sẽ lệch 7 tiếng so với ý định, co/giãn sai khoảng lọc from/to.
function withVnOffset(value: string): string {
  return HAS_TIMEZONE_SUFFIX.test(value) ? value : `${value}+07:00`;
}

// Dùng chung cho mọi bộ lọc kiểu from/to trên 1 mốc thời gian (StockMovement.createdAt,
// Order.createdAt...) — chuỗi ngày thuần "YYYY-MM-DD" (tham số `to`) phải được hiểu là hết
// ngày đó theo giờ VN, nếu không new Date() sẽ parse ra 00:00 UTC và loại mất hết dữ liệu
// trong đúng ngày được chọn. Chuỗi đã kèm giờ (FE tự gửi "...T23:59:59.999") cũng được neo
// theo giờ VN tương tự (chưa có hậu tố múi giờ thì FE cũng có ý đó), không cộng dồn 2 lần
// nếu đã tự mang múi giờ.
export function toInclusiveEndOfDay(value: string): Date {
  return new Date(
    withVnOffset(
      DATE_ONLY_PATTERN.test(value) ? `${value}T23:59:59.999` : value,
    ),
  );
}

// Đi cặp với toInclusiveEndOfDay() cho tham số `from` — 2 đầu mút của cùng 1 khoảng ngày
// phải neo theo cùng 1 quy tắc múi giờ, không thì khoảng lọc bị co/giãn sai.
export function toInclusiveStartOfDay(value: string): Date {
  return new Date(
    withVnOffset(
      DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00.000` : value,
    ),
  );
}

// Dùng chung cho mọi nơi cần chặn chọn ngày bắt đầu trong quá khứ (Collection, Flash Sale...)
// — so theo NGÀY LỊCH (bỏ qua giờ, cùng cách toDateOnly() đang dùng cho deriveDateRangeStatus)
// để admin chọn "hôm nay" vẫn hợp lệ dù giờ hiện tại đã qua nửa đêm giờ server. Trả boolean
// thuần, KHÔNG ném lỗi — mỗi domain tự quyết định ném lỗi gì/mã nào (xem
// assertStartDateNotInPast() ở collections.service.ts và flash-sales.service.ts).
export function isDateInPast(date: string): boolean {
  return toDateOnly(new Date(date)) < toDateOnly(new Date());
}

// Flash Sale hoạt động ở granularity GIỜ (1 campaign có thể chỉ kéo dài vài giờ trong cùng
// ngày — khác Collection/Banner luôn là chiến dịch nhiều ngày/tuần), nên KHÔNG dùng
// deriveDateRangeStatus() (cắt về ngày lịch qua toDateOnly()) — phải so theo TIMESTAMP CHÍNH
// XÁC bằng new Date(), nếu không: (1) 2 campaign khác giờ cùng ngày sẽ cùng báo RUNNING dù
// không trùng giờ nhau thật, (2) endNow() (set endDate = new Date()) sẽ không khiến status
// chuyển sang ENDED cho tới tận nửa đêm UTC. Trả cùng type DateRangeStatus để tái dùng được
// FLASH_SALE_STATUS_LABEL/COLOR ở FE mà không cần đổi gì.
export function deriveInstantRangeStatus(
  startDate: Date,
  endDate: Date,
): DateRangeStatus {
  const now = new Date();
  if (now < startDate) return 'UPCOMING';
  if (now > endDate) return 'ENDED';
  return 'RUNNING';
}

// Cặp với deriveInstantRangeStatus() — so theo TIMESTAMP CHÍNH XÁC (không cắt về ngày lịch
// như isDateInPast()), vì Flash Sale cho phép startDate là "hôm nay nhưng giờ cụ thể trong
// tương lai" (vd tạo lúc 09:00, đợt sale bắt đầu 20:00 cùng ngày) — nếu dùng isDateInPast()
// (so ngày) thì campaign này sẽ bị coi là RUNNING ngay khi vừa tạo thay vì đúng là UPCOMING.
export function isInstantInPast(date: string): boolean {
  return new Date(date).getTime() < Date.now();
}
