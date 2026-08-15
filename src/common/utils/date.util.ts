import { BadRequestException } from '@nestjs/common';

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
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
  }
}
