// Lưu dạng số trong DB (Product.status là Int, không còn Prisma enum) — Postgres native
// enum luôn lưu string, không có cách nào khiến Prisma tự lưu enum dạng số.
export enum ProductStatus {
  DRAFT = 0,
  ACTIVE = 1,
  INACTIVE = 2,
}
