import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

const LOW_STOCK_THRESHOLD_KEY = 'lowStockThreshold';
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getLowStockThreshold(): Promise<number> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: LOW_STOCK_THRESHOLD_KEY },
    });
    return config ? parseInt(config.value, 10) : DEFAULT_LOW_STOCK_THRESHOLD;
  }

  async setLowStockThreshold(value: number): Promise<number> {
    await this.prisma.systemConfig.upsert({
      where: { key: LOW_STOCK_THRESHOLD_KEY },
      create: { key: LOW_STOCK_THRESHOLD_KEY, value: String(value) },
      update: { value: String(value) },
    });
    return value;
  }
}
