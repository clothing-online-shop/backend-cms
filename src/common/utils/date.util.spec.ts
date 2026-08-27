import {
  toInclusiveEndOfDay,
  toInclusiveStartOfDay,
  isDateInPast,
  deriveInstantRangeStatus,
  isInstantInPast,
} from './date.util';

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

describe('isDateInPast', () => {
  it('ngày trong quá khứ (hôm qua) → true', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isDateInPast(yesterday.toISOString())).toBe(true);
  });

  it('hôm nay → false (so theo ngày lịch, không phải giờ chính xác)', () => {
    expect(isDateInPast(new Date().toISOString())).toBe(false);
  });

  it('ngày trong tương lai → false', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isDateInPast(tomorrow.toISOString())).toBe(false);
  });
});

// Cặp hàm dành cho Flash Sale — so theo TIMESTAMP chính xác (không cắt về ngày lịch), nên
// các case dưới đây cố ý dùng chênh lệch GIỜ trong cùng 1 ngày: đó chính là phần
// deriveDateRangeStatus()/isDateInPast() trả sai cho Flash Sale.
describe('deriveInstantRangeStatus', () => {
  const ONE_HOUR = 60 * 60 * 1000;

  it('now trước startDate (cùng ngày, muộn hơn vài giờ) → UPCOMING', () => {
    const start = new Date(Date.now() + ONE_HOUR);
    const end = new Date(Date.now() + 2 * ONE_HOUR);
    expect(deriveInstantRangeStatus(start, end)).toBe('UPCOMING');
  });

  it('now nằm giữa startDate và endDate → RUNNING', () => {
    const start = new Date(Date.now() - ONE_HOUR);
    const end = new Date(Date.now() + ONE_HOUR);
    expect(deriveInstantRangeStatus(start, end)).toBe('RUNNING');
  });

  it('now sau endDate (cùng ngày, sớm hơn vài giờ) → ENDED', () => {
    const start = new Date(Date.now() - 2 * ONE_HOUR);
    const end = new Date(Date.now() - ONE_HOUR);
    expect(deriveInstantRangeStatus(start, end)).toBe('ENDED');
  });
});

describe('isInstantInPast', () => {
  const ONE_HOUR = 60 * 60 * 1000;

  it('mốc thời gian 1 giờ trước → true (dù vẫn trong cùng ngày lịch)', () => {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR);
    expect(isInstantInPast(oneHourAgo.toISOString())).toBe(true);
  });

  it('mốc thời gian 1 giờ nữa → false', () => {
    const inOneHour = new Date(Date.now() + ONE_HOUR);
    expect(isInstantInPast(inOneHour.toISOString())).toBe(false);
  });
});
