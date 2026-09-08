import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './config/prisma.module';
import { RedisModule } from './config/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CmsModule } from './modules/cms/cms.module';
import { UploadModule } from './modules/upload/upload.module';
import { BannersModule } from './modules/banners/banners.module';
import { PopupsModule } from './modules/popups/popups.module';
import { PromoBarsModule } from './modules/promo-bars/promo-bars.module';
import { LocationsModule } from './modules/locations/locations.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { FlashSalesModule } from './modules/flash-sales/flash-sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CategoriesModule,
    BrandsModule,
    CollectionsModule,
    InventoryModule,
    OrdersModule,
    CmsModule,
    UploadModule,
    BannersModule,
    PopupsModule,
    PromoBarsModule,
    LocationsModule,
    VouchersModule,
    FlashSalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
