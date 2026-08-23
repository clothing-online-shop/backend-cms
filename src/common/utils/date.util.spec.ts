import { toInclusiveEndOfDay, toInclusiveStartOfDay } from './date.util';

// So bằng toISOString() (luôn quy về UTC, không phụ thuộc múi giờ máy chạy test) — 2 hàm
// dưới đây neo tường minh theo giờ VN (UTC+7) ngay trong implementation (xem withVnOffset()
// trong date.util.ts), nên kết quả phải là 1 giá trị UTC cố định bất kể test chạy ở TZ nào,
// không còn dùng getHours()/getMinutes() (đọc theo giờ LOCAL của máy chạy test — trước đây
// test kiểu này chỉ "tình cờ" đúng vì máy dev chạy giờ VN, sẽ fail nếu CI chạy TZ khác).
describe('toInclusiveEndOfDay', () => {
  it('chuỗi ngày thuần "YYYY-MM-DD" → 23:59:59.999 giờ VN, quy đổi đúng sang UTC', () => {
    const result = toInclusiveEndOfDay('2026-08-21');
    expect(result.toISOString()).toBe('2026-08-21T16:59:59.999Z');
  });

  it('chuỗi đã kèm giờ nhưng KHÔNG có hậu tố múi giờ → hiểu là giờ VN', () => {
    const result = toInclusiveEndOfDay('2026-08-21T23:59:59.999');
    expect(result.toISOString()).toBe('2026-08-21T16:59:59.999Z');
  });

  it('chuỗi đã tự mang múi giờ (Z) → giữ nguyên, không gán đè +07:00', () => {
    const result = toInclusiveEndOfDay('2026-08-21T10:00:00.000Z');
    expect(result.toISOString()).toBe('2026-08-21T10:00:00.000Z');
  });
});

describe('toInclusiveStartOfDay', () => {
  it('chuỗi ngày thuần "YYYY-MM-DD" → 00:00:00.000 giờ VN, quy đổi đúng sang UTC', () => {
    const result = toInclusiveStartOfDay('2026-08-21');
    expect(result.toISOString()).toBe('2026-08-20T17:00:00.000Z');
  });

  it('chuỗi đã tự mang múi giờ → giữ nguyên, không gán đè +07:00', () => {
    const result = toInclusiveStartOfDay('2026-08-21T00:00:00.000+09:00');
    expect(result.toISOString()).toBe('2026-08-20T15:00:00.000Z');
  });

  it('from và to của cùng 1 ngày phải neo cùng 1 quy tắc múi giờ (khoảng cách đúng 24h)', () => {
    const start = toInclusiveStartOfDay('2026-08-21');
    const end = toInclusiveEndOfDay('2026-08-21');
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000 - 1);
  });
});
