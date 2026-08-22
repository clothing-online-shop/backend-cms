import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../config/prisma.service';

function amountDecimal(value: number) {
  return { toNumber: () => value };
}

function bankTransferOrder(overrides: Partial<{ paymentStatus: string }> = {}) {
  return {
    id: 'order-1',
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: overrides.paymentStatus ?? 'UNPAID',
    totalAmount: amountDecimal(389000),
  };
}

interface PaymentTransactionCreateArgs {
  data: {
    orderId: string;
    provider: string;
    status: string;
    amount: { toNumber(): number };
  };
}

function createMocks() {
  const findUnique = jest.fn();
  const update = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...bankTransferOrder(),
      ...data,
      totalAmount: amountDecimal(389000),
    }),
  );
  let paymentTransactionCreateArgs: PaymentTransactionCreateArgs | undefined;
  const paymentTransactionCreate = jest
    .fn()
    .mockImplementation((args: PaymentTransactionCreateArgs) => {
      paymentTransactionCreateArgs = args;
      return Promise.resolve({});
    });

  const tx = {
    order: { update },
    paymentTransaction: { create: paymentTransactionCreate },
  };

  const prisma = {
    order: { findUnique },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    prisma,
    findUnique,
    update,
    paymentTransactionCreate,
    getPaymentTransactionCreateArgs: () => paymentTransactionCreateArgs,
  };
}

describe('OrdersService.confirmBankTransfer', () => {
  it('không tìm thấy đơn thì 404', async () => {
    const { prisma, findUnique } = createMocks();
    findUnique.mockResolvedValue(null);
    const service = new OrdersService(prisma);

    await expect(service.confirmBankTransfer('order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('không phải đơn chuyển khoản thì báo lỗi', async () => {
    const { prisma, findUnique } = createMocks();
    findUnique.mockResolvedValue({
      ...bankTransferOrder(),
      paymentMethod: 'VNPAY',
    });
    const service = new OrdersService(prisma);

    await expect(service.confirmBankTransfer('order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đơn đã PAID rồi thì báo lỗi, không xác nhận lại', async () => {
    const { prisma, findUnique, update } = createMocks();
    findUnique.mockResolvedValue(bankTransferOrder({ paymentStatus: 'PAID' }));
    const service = new OrdersService(prisma);

    await expect(service.confirmBankTransfer('order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('xác nhận thành công: PAID + CONFIRMED, ghi PaymentTransaction SUCCESS, totalAmount là number', async () => {
    const { prisma, findUnique, update, getPaymentTransactionCreateArgs } =
      createMocks();
    findUnique.mockResolvedValue(bankTransferOrder());
    const service = new OrdersService(prisma);

    const result = await service.confirmBankTransfer('order-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    const createArgs = getPaymentTransactionCreateArgs();
    expect(createArgs?.data.orderId).toBe('order-1');
    expect(createArgs?.data.provider).toBe('BANK_TRANSFER');
    expect(createArgs?.data.status).toBe('SUCCESS');
    expect(createArgs?.data.amount.toNumber()).toBe(389000);
    expect(result.totalAmount).toBe(389000);
    expect(typeof result.totalAmount).toBe('number');
  });
});
