// Chạy `mapper` cho từng phần tử của `items` với tối đa `concurrency` tác vụ cùng lúc (worker
// pool), thay vì tuần tự từng cái (chậm khi có hàng trăm/nghìn request ra API ngoài) hoặc
// Promise.all không giới hạn (dễ bị rate-limit/quá tải). Giữ nguyên thứ tự kết quả theo `items`.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (concurrency < 1) {
    throw new Error('mapWithConcurrency: concurrency phải >= 1.');
  }

  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
