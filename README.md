# backend-cms

Backend API phục vụ **quản trị viên** cho hệ thống Clothing Shop — được `frontend-admin` gọi trực tiếp. Đây là 1 trong 4 repo độc lập của hệ thống (không còn là monorepo/workspace chung):

| Repo | Vai trò | Port local |
|---|---|---|
| [backend-user](https://github.com/clothing-online-shop/backend-user) | API công khai cho khách hàng | `3001` |
| **backend-cms** (repo này) | API quản trị cho admin | `3002` |
| [frontend-website](https://github.com/clothing-online-shop/frontend-website) | Website bán hàng (Next.js) | `3000` |
| [frontend-admin](https://github.com/clothing-online-shop/frontend-admin) | Trang quản trị (Vite + React) | `5173` |

`backend-user` và `backend-cms` dùng **chung một database PostgreSQL** (khác vai trò, khác cổng, khác `JWT_SECRET`, nhưng cùng schema/dữ liệu). **Repo này là nơi duy nhất được chạy Prisma migration** — xem phần Prisma bên dưới.

## Tech stack

- NestJS 11 + TypeScript
- Prisma ORM + PostgreSQL
- Redis (ioredis)
- Passport JWT (access + refresh token) — hash mật khẩu bằng `argon2`
- Cloudinary SDK (upload ảnh sản phẩm/banner)
- class-validator / class-transformer cho DTO
- Swagger (`@nestjs/swagger`) tự sinh doc tại `/api/docs`
- nestjs-pino cho log có cấu trúc

## Module & route hiện có

Chỉ giữ lại phần quản trị — mọi route dành riêng khách hàng (đăng ký, quên mật khẩu, giỏ hàng, thanh toán) nằm bên `backend-user`.

| Module | Route | Ghi chú |
|---|---|---|
| `auth` | `POST /auth/login` | **Chỉ tài khoản `role = ADMIN`** mới đăng nhập được — tài khoản CUSTOMER bị từ chối (401) dù đúng mật khẩu |
| | `POST /auth/refresh` | Cấp lại token (dùng `JWT_REFRESH_SECRET` riêng của backend này) |
| | `GET /auth/me` | Thông tin admin hiện tại |
| `categories` | `GET /categories`, `GET /categories/:slug`, `POST /categories`, `PATCH /categories/reorder`, `PATCH /categories/:id`, `DELETE /categories/:id` | Đầy đủ CRUD + sắp xếp cây danh mục (route ghi cần Bearer token ADMIN) |
| `products` | `GET /products`, `GET /products/:slug`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` (soft-delete → INACTIVE), `PATCH /products/:id/variants/:variantId/stock` | Đầy đủ CRUD + quản lý variants (size/màu/SKU/giá/tồn kho) |
| `upload` | `POST /upload/image`, `DELETE /upload/image/:publicId` | Upload/xóa ảnh qua Cloudinary — toàn bộ route yêu cầu role ADMIN |
| `orders` | *(chưa có route)* | Scaffold cho tính năng xem toàn bộ đơn hàng + cập nhật trạng thái, triển khai sau |
| `cms` | *(chưa có route)* | Scaffold cho banner/blog/trang tĩnh, triển khai sau |
| `users` | *(không có route public)* | Chỉ tồn tại như dependency nội bộ để `auth` tra cứu user khi login — không phải domain quản lý user ở backend này |

## Yêu cầu môi trường

- Node.js 22+, `pnpm`
- PostgreSQL 16 + Redis 7 chạy local — **khởi động ở `backend-user` trước** (xem README của `backend-user`), vì `docker-compose.yml` chỉ đặt ở đó để tránh chạy trùng 2 lần cho cùng 1 database.

## Cài đặt & chạy local

```bash
# 1. Cài dependency (độc lập, không chạy từ thư mục cha)
pnpm install

# 2. Tạo .env từ mẫu, chỉnh nếu cần
cp .env.example .env

# 3. Đảm bảo Postgres/Redis đã chạy (docker compose up -d ở thư mục backend-user, hoặc service native)

# 4. Áp dụng migration + sinh Prisma Client
pnpm prisma:migrate

# 5. (Lần đầu) seed dữ liệu mẫu: admin, danh mục, sản phẩm
pnpm seed

# 6. Chạy dev server (watch mode)
pnpm dev
```

Server chạy ở `http://localhost:3002`, Swagger docs tại `http://localhost:3002/api/docs`, health check tại `http://localhost:3002/health`.

## Biến môi trường (`.env`)

| Biến | Mô tả |
|---|---|
| `DATABASE_URL` | Kết nối Postgres — **phải trỏ cùng database với `backend-user`** |
| `REDIS_URL` | Kết nối Redis |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Secret ký JWT — **khác với `backend-user`**, để token của khách và admin không thể dùng chéo giữa 2 backend |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Thời hạn token (mặc định `15m` / `7d`) |
| `PORT` | Mặc định `3002` |
| `CMS_ORIGIN` | Origin của `frontend-admin` được phép gọi CORS (mặc định `http://localhost:5173`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Thông tin Cloudinary cho module `upload` — cần điền key thật để test upload ảnh |

## Prisma — quy tắc migration

**Đây là repo duy nhất được chạy `prisma migrate dev`.** `backend-user` trỏ cùng database nhưng chỉ chạy `prisma generate`.

Quy trình khi cần đổi schema:
1. Sửa `prisma/schema.prisma` ở đây, chạy: `pnpm prisma:migrate` (tương đương `prisma migrate dev --name <mo-ta-thay-doi>`).
2. Copy `prisma/schema.prisma` + thư mục `prisma/migrations` mới sang `backend-user`.
3. Báo team để bên `backend-user` chạy lại `pnpm prisma:generate`.

Không sửa tay migration đã áp dụng, không sửa DB trực tiếp qua pgAdmin cho thay đổi cấu trúc.

## Scripts

| Lệnh | Mô tả |
|---|---|
| `pnpm dev` | Chạy dev server (watch mode) |
| `pnpm build` | Build production (`dist/`) |
| `pnpm start:prod` | Chạy bản đã build |
| `pnpm lint` | ESLint (`--fix`) |
| `pnpm test`, `pnpm test:e2e` | Unit test / e2e test |
| `pnpm prisma:migrate` | Tạo & áp dụng migration mới (`prisma migrate dev`) |
| `pnpm prisma:generate` | Chỉ sinh lại Prisma Client, không tạo migration |
| `pnpm prisma:studio` | Mở Prisma Studio để xem/sửa dữ liệu trực quan |
| `pnpm seed` | Chạy `prisma/seed.ts` — seed 1 admin, 6 danh mục, 18 sản phẩm mẫu |

## Tài khoản admin mặc định (sau khi seed)

| Email | Mật khẩu |
|---|---|
| `admin@clothing-shop.com` | `admin123` |

Tạo thêm admin khác bằng script Node (dùng `argon2` để hash mật khẩu rồi upsert vào bảng `users` với `role: 'ADMIN'`), hoặc thêm trực tiếp qua Prisma Studio.
