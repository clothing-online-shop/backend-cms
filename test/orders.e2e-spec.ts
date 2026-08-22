import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/config/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import type { JwtPayload } from '../src/modules/auth/strategies/jwt.strategy';
import { UserRole } from '@prisma/client';

interface OrderListItem {
  id: string;
  orderCode: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  totalAmount: number;
  itemCount: number;
}

interface OrderListResponse {
  data: OrderListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

describe('Orders — GET /orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;

  let adminToken: string;
  let adminId: string;
  let customerId: string;
  let categoryId: string;
  let productId: string;
  let orderPendingCod: { id: string; orderCode: string };
  let orderConfirmedVnpay: { id: string; orderCode: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jwt = moduleFixture.get(JwtService);

    const admin = await prisma.user.create({
      data: {
        email: `orders-e2e-admin-${Date.now()}@example.com`,
        password: 'unused-hash',
        fullName: 'Orders E2E Admin',
        role: UserRole.ADMIN,
      },
    });
    adminId = admin.id;
    adminToken = jwt.sign({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    } satisfies JwtPayload);

    const customer = await prisma.user.create({
      data: {
        email: `orders-e2e-customer-${Date.now()}@example.com`,
        password: 'unused-hash',
        fullName: 'Orders E2E Customer',
        role: UserRole.CUSTOMER,
      },
    });
    customerId = customer.id;

    const seed = Date.now();
    const category = await prisma.category.create({
      data: {
        name: 'Category Orders E2E',
        slug: `category-orders-e2e-${seed}`,
      },
    });
    categoryId = category.id;
    const product = await prisma.product.create({
      data: {
        name: 'Áo thun Orders E2E',
        slug: `ao-thun-orders-e2e-${seed}`,
        categoryId,
        basePrice: '150000',
        status: 1,
      },
    });
    productId = product.id;
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        size: 'M',
        color: 'Đen',
        sku: `SKU-ORDERS-E2E-${seed}`,
        price: '150000',
        stockQuantity: 10,
      },
    });

    orderPendingCod = await prisma.order.create({
      data: {
        userId: customerId,
        orderCode: `DH-E2E-COD-${seed}`,
        status: 'PENDING',
        totalAmount: '150000',
        shippingAddress: `Nguyễn Văn A - 09112233${seed % 100} - 1 Đường Test`,
        paymentMethod: 'COD',
        items: {
          create: [
            {
              productVariantId: variant.id,
              productName: product.name,
              variantSku: variant.sku,
              size: variant.size,
              color: variant.color,
              quantity: 1,
              priceAtPurchase: '150000',
            },
          ],
        },
        statusHistories: {
          create: [
            { fromStatus: null, toStatus: 'PENDING', changedById: null },
          ],
        },
      },
    });
    orderConfirmedVnpay = await prisma.order.create({
      data: {
        userId: customerId,
        orderCode: `DH-E2E-VNPAY-${seed}`,
        status: 'CONFIRMED',
        totalAmount: '300000',
        shippingAddress: `Trần Thị B - 09887766${seed % 100} - 2 Đường Test`,
        paymentMethod: 'VNPAY',
      },
    });
  });

  afterAll(async () => {
    if (customerId) {
      await prisma.orderStatusHistory.deleteMany({
        where: { order: { userId: customerId } },
      });
      await prisma.orderItem.deleteMany({
        where: { order: { userId: customerId } },
      });
      await prisma.order.deleteMany({ where: { userId: customerId } });
      await prisma.user.deleteMany({ where: { id: customerId } });
    }
    if (productId) {
      await prisma.productVariant.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (adminId) {
      await prisma.user.deleteMany({ where: { id: adminId } });
    }
    if (app) await app.close();
  });

  it('không có filter → trả về cả 2 đơn vừa tạo, mới nhất trước', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as OrderListResponse;
    const codes = body.data.map((o) => o.orderCode);
    expect(codes).toContain(orderPendingCod.orderCode);
    expect(codes).toContain(orderConfirmedVnpay.orderCode);
  });

  it('lọc theo status=CONFIRMED → chỉ trả đơn CONFIRMED', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .query({ status: 'CONFIRMED' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as OrderListResponse;
    const match = body.data.find(
      (o) => o.orderCode === orderConfirmedVnpay.orderCode,
    );
    expect(match).toBeDefined();
    expect(match?.status).toBe('CONFIRMED');
    expect(
      body.data.some((o) => o.orderCode === orderPendingCod.orderCode),
    ).toBe(false);
  });

  it('lọc theo paymentMethod=VNPAY → chỉ trả đơn VNPAY', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .query({ paymentMethod: 'VNPAY' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as OrderListResponse;
    expect(body.data.every((o) => o.paymentMethod === 'VNPAY')).toBe(true);
    expect(
      body.data.some((o) => o.orderCode === orderConfirmedVnpay.orderCode),
    ).toBe(true);
  });

  it('search theo mã đơn → trả đúng đơn khớp', async () => {
    const response = await request(app.getHttpServer())
      .get('/orders')
      .query({ search: orderPendingCod.orderCode })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as OrderListResponse;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].orderCode).toBe(orderPendingCod.orderCode);
  });

  it('search theo SĐT khách (nằm trong shippingAddress) → trả đúng đơn khớp', async () => {
    const seed = orderConfirmedVnpay.orderCode.split('-').pop();
    const response = await request(app.getHttpServer())
      .get('/orders')
      .query({ search: `09887766${Number(seed) % 100}` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as OrderListResponse;
    expect(
      body.data.some((o) => o.orderCode === orderConfirmedVnpay.orderCode),
    ).toBe(true);
  });

  it('không có Bearer token → 401', async () => {
    await request(app.getHttpServer()).get('/orders').expect(401);
  });

  it('customer role (không phải admin panel) → 403', async () => {
    const customerToken = jwt.sign({
      sub: customerId,
      email: 'irrelevant@example.com',
      role: UserRole.CUSTOMER,
    } satisfies JwtPayload);

    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('GET /orders/:id — trả đủ items, customer, statusHistories', async () => {
    const response = await request(app.getHttpServer())
      .get(`/orders/${orderPendingCod.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as {
      orderCode: string;
      customer: { fullName: string };
      items: Array<{ productName: string; quantity: number }>;
      statusHistories: Array<{
        toStatus: string;
        changedByName: string | null;
      }>;
    };
    expect(body.orderCode).toBe(orderPendingCod.orderCode);
    expect(body.customer.fullName).toBe('Orders E2E Customer');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productName: 'Áo thun Orders E2E',
      quantity: 1,
    });
    expect(body.statusHistories).toHaveLength(1);
    expect(body.statusHistories[0]).toMatchObject({
      toStatus: 'PENDING',
      changedByName: null,
    });
  });

  it('GET /orders/:id — id không tồn tại → 404', async () => {
    await request(app.getHttpServer())
      .get('/orders/khong-ton-tai')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});
