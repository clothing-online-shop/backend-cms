// Tính tập id "mới thêm vào" so với tập hiện có — dùng chung ở 2 chiều gán N-N sản phẩm ↔
// bộ sưu tập (CollectionsService.assignProducts() và ProductsService.assignCollections()),
// cả 2 đều là endpoint "thay thế toàn bộ danh sách" nhưng chỉ cần áp business rule (chặn
// ENDED/không ACTIVE...) cho phần tử THỰC SỰ mới, giữ nguyên phần tử cũ dù sau đó không còn
// hợp lệ để tránh việc lưu lại đúng set cũ (không đổi gì) cũng bị chặn nhầm.
export function diffNewlyAdded(
  desiredIds: string[],
  currentIds: Set<string>,
): string[] {
  return desiredIds.filter((id) => !currentIds.has(id));
}
