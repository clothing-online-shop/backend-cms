export const ErrorCode = {
  CATEGORY_NAME_DUPLICATE: 1001,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
