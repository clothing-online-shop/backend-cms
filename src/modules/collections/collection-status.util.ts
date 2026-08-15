import { toDateOnly } from '../../common/utils/date.util';

// Riêng cho Collection (không phải hàm dùng chung) — CollectionsService dùng để tính
// status UPCOMING/RUNNING/ENDED, ProductsService dùng để chặn gán sản phẩm vào collection
// đã kết thúc.
export function isCollectionEnded(endDate: Date): boolean {
  return toDateOnly(new Date()) > toDateOnly(endDate);
}
