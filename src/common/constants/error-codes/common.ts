// Dùng chung nhiều module qua common/utils (date.util.ts, image-pairing.util.ts) — không
// thuộc riêng 1 domain nên không nằm trong range 1000+ như các module khác.
export const CommonErrorCode = {
  COMMON_IMAGE_PUBLIC_ID_MISMATCH: 1,
  COMMON_IMAGES_COUNT_MISMATCH: 2,
  COMMON_DATE_RANGE_INVALID: 3,
} as const;
