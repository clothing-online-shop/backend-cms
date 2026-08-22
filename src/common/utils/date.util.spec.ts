import { toInclusiveEndOfDay } from './date.util';

describe('toInclusiveEndOfDay', () => {
  // Dùng getter theo giờ local (không phải toISOString) — hàm parse chuỗi ngày thuần
  // theo giờ local của máy chạy, so bằng toISOString (luôn quy về UTC) sẽ flaky tuỳ
  // timezone máy chạy test.
  it('chuỗi ngày thuần "YYYY-MM-DD" → hiểu là 23:59:59.999 của ngày đó', () => {
    const result = toInclusiveEndOfDay('2026-08-21');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(7); // Tháng 8 = index 7
    expect(result.getDate()).toBe(21);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });

  it('chuỗi đã kèm giờ → giữ nguyên, không cộng dồn thêm', () => {
    const result = toInclusiveEndOfDay('2026-08-21T10:00:00.000Z');
    expect(result.toISOString()).toBe('2026-08-21T10:00:00.000Z');
  });
});
