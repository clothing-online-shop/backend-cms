import { Prisma, StockMovementType } from '@prisma/client';

// Ghi 1 StockMovement + cộng dồn tồn kho trong CÙNG 1 transaction — dùng chung giữa
// InventoryService (import/adjust tay) và OrdersService (tự động hoàn kho khi hủy đơn),
// trước đây chỉ có 1 bản private trong InventoryService. Gọi hàm này BÊN TRONG 1
// transaction đã mở sẵn (không tự mở transaction riêng) để chỗ gọi kiểm soát được phạm vi
// atomic rộng hơn nếu cần (vd OrdersService cần hoàn kho + đổi status + ghi lịch sử cùng
// lúc).
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  params: {
    variantId: string;
    type: StockMovementType;
    delta: number;
    note?: string | null;
    createdById: string;
  },
): Promise<void> {
  await tx.stockMovement.create({
    data: {
      productVariantId: params.variantId,
      type: params.type,
      quantity: params.delta,
      note: params.note,
      createdById: params.createdById,
    },
  });
  await tx.productVariant.update({
    where: { id: params.variantId },
    data: { stockQuantity: { increment: params.delta } },
  });
}
