import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Cập nhật Order kèm điều kiện "chưa đổi kể từ lúc đọc" (optimistic concurrency) — `where`
// PHẢI kèm đủ field snapshot lúc đọc (status/paymentStatus...) để updateMany chỉ khớp đúng
// bản ghi còn nguyên trạng thái đã đọc; count===0 nghĩa là 1 request khác đã đổi bản ghi
// xen giữa, throw Conflict thay vì âm thầm ghi đè lên dữ liệu đã stale. Dùng chung giữa
// updateStatus() và confirmBankTransfer() ở orders.service.ts — 2 nơi trước đây viết riêng
// và 1 bản đã quên kèm `status` trong where, tạo lỗ hổng race condition không ai phát hiện.
export async function updateOrderIfUnchanged(
  tx: Prisma.TransactionClient,
  where: Prisma.OrderWhereUniqueInput & Prisma.OrderWhereInput,
  data: Prisma.OrderUpdateManyMutationInput,
): Promise<void> {
  const { count } = await tx.order.updateMany({ where, data });
  if (count === 0) {
    throw new ConflictException(
      'Đơn hàng vừa được cập nhật bởi thao tác khác, vui lòng thử lại.',
    );
  }
}
