// Trạng thái không lưu DB — luôn tính lại từ startDate/endDate so với thời điểm
// request tới, vì nó phụ thuộc "bây giờ" chứ không phải state cố định của bản ghi.
export enum CollectionStatus {
  UPCOMING = 'UPCOMING',
  RUNNING = 'RUNNING',
  ENDED = 'ENDED',
}
