// AUTH_SESSION_EXPIRED/AUTH_FORBIDDEN_ROLE ném ở guard (common/guards/jwt-auth.guard.ts,
// common/guards/roles.guard.ts), không phải ở auth.service.ts — nhưng cùng domain Auth nên
// gộp chung file này cho dễ tìm.
export const AuthErrorCode = {
  AUTH_INVALID_CREDENTIALS: 1401,
  AUTH_NOT_ADMIN: 1402,
  AUTH_ACCOUNT_DISABLED: 1403,
  // Dùng chung cho cả 2 lý do refresh token không hợp lệ (verify JWT thất bại / không khớp
  // token đã lưu) — FE chỉ cần biết "phải đăng nhập lại", không cần phân biệt lý do cụ thể.
  AUTH_REFRESH_TOKEN_INVALID: 1404,
  AUTH_REFRESH_USER_NOT_FOUND: 1405,
  AUTH_SESSION_EXPIRED: 1406,
  AUTH_FORBIDDEN_ROLE: 1407,
} as const;
