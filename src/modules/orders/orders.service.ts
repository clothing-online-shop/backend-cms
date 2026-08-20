import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // Chỉ áp dụng cho đơn chuyển khoản — VNPay/COD có luồng cập nhật trạng thái riêng của
  // chúng (VNPay qua IPN ở backend-user, COD qua giao hàng, cả 2 không thuộc phạm vi
  // module này). Đây là hành động thủ công duy nhất admin cần cho luồng chuyển khoản: xác
  // nhận đã nhận tiền — không xây cả module quản lý đơn hàng ở đây, việc đó thuộc sprint
  // khác chưa có trong phạm vi hiện tại.
  async confirmBankTransfer(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    if (order.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException(
        'Đơn hàng này không phải thanh toán chuyển khoản',
      );
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException(
        'Đơn hàng đã được xác nhận thanh toán trước đó',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          status: OrderStatus.CONFIRMED,
        },
      });
      await tx.paymentTransaction.create({
        data: {
          orderId: id,
          provider: PaymentProvider.BANK_TRANSFER,
          amount: order.totalAmount,
          status: TransactionStatus.SUCCESS,
        },
      });
      return updated;
    });
  }
}
