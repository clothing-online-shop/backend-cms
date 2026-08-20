# Backend (apps/be) — Quy tắc & Chuẩn code

NestJS + TypeScript + Prisma + PostgreSQL + Redis. API dùng chung cho `apps/web` và `apps/cms`.

## Cấu trúc module (bắt buộc theo mẫu)

Mỗi tính năng là 1 thư mục dưới `src/modules/<ten-module>/`:

```
src/modules/<ten-module>/
├── <ten-module>.module.ts
├── <ten-module>.controller.ts
├── <ten-module>.service.ts
├── dto/                # request/response DTO, 1 file/DTO
└── strategies/          # nếu có passport strategy riêng
```

- Không tạo controller/service dùng chung nhiều nghiệp vụ khác nhau — 1 module = 1 domain (products, orders, payments...).
- Logic nghiệp vụ nằm ở `*.service.ts`. Controller chỉ nhận request, gọi service, trả response — không xử lý logic trong controller.
- Muốn dùng service của module khác: `imports` module đó + đảm bảo `exports` service cần dùng (xem `UsersModule` export `UsersService` để `AuthModule` dùng).
- Đặt tên file/thư mục kebab-case, tên class PascalCase (`ProductsService`, `products.service.ts`).
- Hàm helper (không phải service/DTO/enum) được dùng ở ≥ 2 module → viết vào `src/common/utils/<ten>.util.ts`, không để nằm trong 1 module rồi module khác import chéo qua, càng không copy-paste viết lại (xem `slug.util.ts`, `diff.util.ts`, `date.util.ts`, `image-pairing.util.ts` làm mẫu). Trước khi viết 1 helper mới (so ngày, validate cặp field, format...), grep thử xem `common/utils/` đã có sẵn chưa. Enum/type gắn với đúng 1 model thì vẫn để trong module đó (vd `ProductStatus`, `BannerStatus`) — không phải cái gì dùng chung cũng chuyển ra, chỉ hàm/logic thật sự generic.

## DTO & Validation

- Mọi input từ client phải có DTO riêng trong `dto/`, dùng `class-validator` decorator (`@IsEmail`, `@IsString`, `@MinLength`...).
- Luôn thêm `@ApiProperty()` (từ `@nestjs/swagger`) cho từng field để Swagger tự sinh doc — không viết doc tay.
- Không tắt `whitelist`/`forbidNonWhitelisted` của `ValidationPipe` (đang bật global ở `main.ts`) — nghĩa là field thừa trong body sẽ bị từ chối, đây là chủ đích, không phải bug.

## Xử lý lỗi

- Ném `HttpException` con cháu chuẩn của Nest (`BadRequestException`, `ConflictException`, `UnauthorizedException`, `NotFoundException`...), không tự tạo response lỗi thủ công trong controller.
- `AllExceptionsFilter` (global) đã format lỗi thành `{ statusCode, message, error, timestamp, path }` — không cần catch lại ở controller/service để format response.
- Không để lộ message lỗi nội bộ (stack trace, câu lệnh SQL...) ra response cho client.

## Auth & phân quyền

- Route cần đăng nhập: gắn `@UseGuards(JwtAuthGuard)`.
- Route cần giới hạn theo role: thêm `@Roles(UserRole.ADMIN)` + `@UseGuards(JwtAuthGuard, RolesGuard)`.
- Lấy user hiện tại trong handler bằng `@CurrentUser() user: AuthenticatedUser`, không tự parse lại JWT trong controller.
- Không bao giờ trả field `password` ra response — xem cách `auth.service.ts` dùng `toSafeUser()` để loại bỏ trước khi trả về.
- Mật khẩu luôn hash bằng `argon2` (`argon2.hash` / `argon2.verify`), không tự viết hàm hash khác, không lưu plaintext dù chỉ tạm thời (kể cả trong log).

## Database (Prisma)

- Mọi thay đổi schema đi qua `prisma/schema.prisma` rồi chạy `pnpm --filter @clothing-shop/be prisma:migrate` (`prisma migrate dev --name <mo-ta-thay-doi>`) — không sửa tay migration đã áp dụng, không sửa DB trực tiếp qua pgAdmin cho thay đổi cấu trúc.
- Môi trường deploy (Render...) chạy `start:prod` = `prisma migrate deploy && node dist/main` — mọi migration mới tự áp vào DB thật trước khi server nhận request, không cần SSH/chạy tay `prisma migrate deploy` sau mỗi lần deploy. Nếu đổi Start Command trên Render dashboard, phải giữ nguyên `prisma migrate deploy` ở đầu, không chỉ chạy thẳng `node dist/main`.
- Không import `@prisma/client` trực tiếp trong service để tạo `PrismaClient` mới — luôn inject `PrismaService` (đã được `PrismaModule` quản lý lifecycle connect/disconnect).
- Đặt tên bảng (`@@map`) theo snake_case số nhiều (`users`, `product_variants`) như đã có, giữ nhất quán khi thêm bảng mới.
- Quan hệ 1-nhiều/n-n phải có `@@index` trên khóa ngoại hay dùng (xem các model hiện tại làm mẫu).

## Cấu hình & bí mật

- Không hardcode secret/connection string trong code — luôn qua `ConfigService.get()` với giá trị mặc định hợp lý cho dev (xem `auth.module.ts`, `redis.module.ts`).
- Thêm biến môi trường mới → phải thêm luôn vào `.env.example` (không thêm giá trị thật/nhạy cảm vào file `.example`).
- `.env` thật không commit (đã có trong `.gitignore` ở root).

## Response & API contract

- Mọi controller mới phải gắn `@ApiTags('<ten-domain>')` ở class và `@ApiOperation({ summary: '...' })` ở từng method — Swagger (`/api/docs`) là nguồn contract để 2 FE code song song, phải luôn đúng và đầy đủ.
- Endpoint cần trả 200 thay vì 201 mặc định (POST không tạo resource, ví dụ login) → thêm `@HttpCode(HttpStatus.OK)`.

## Test

- Auth và Orders là 2 module bắt buộc phải có test (unit cho service, e2e cho luồng chính) khi đã có logic thật, trước khi coi là "xong" — đây là luồng đăng nhập và đơn hàng, lỗi ở đây ảnh hưởng trực tiếp khách hàng. Payments/thanh toán không phải module của backend-cms (chỉ có model `PaymentTransaction`, logic thật nằm ở `backend-user`) — không áp dụng rule này ở repo này.
- Hiện trạng (cần trả nợ, không phải ngoại lệ được bỏ qua): `orders` hiện chỉ là stub rỗng (`OrdersService {}` + TODO) — rule test áp dụng ngay khi bắt đầu triển khai logic thật, không đợi xong hẳn mới viết. `auth` đã có logic thật (login/refresh token/argon2) nhưng **hiện chưa có test nào** dù thuộc diện bắt buộc.
- Chạy `pnpm --filter @clothing-shop/be test` trước khi coi 1 module là hoàn thành.

## Sau khi pull code (trước khi code tiếp)

Bỏ qua bước nào trong đây dễ dính lỗi kiểu "TS báo field/enum không tồn tại dù schema đã có" hoặc `EPERM` khi generate — đã gặp thật, không phải phòng hờ lý thuyết.

1. `pnpm install` nếu `package.json`/`pnpm-lock.yaml` đổi.
2. So `.env.example` với `.env` của mình, thêm biến còn thiếu — `.env` không tự đồng bộ theo `.env.example` khi pull.
3. **Tắt hẳn dev server đang chạy trước khi làm bước 4** — trên Windows, Node đang chạy giữ khoá file `query_engine-windows.dll.node`, `prisma generate`/`migrate` sẽ báo `EPERM` nếu chưa tắt.
4. `npx prisma migrate dev` — áp dụng migration mới + tự generate lại Prisma Client (bắt buộc mỗi khi `schema.prisma` đổi, kể cả khi không có migration mới, vì TypeScript vẫn dùng type Client cũ nếu không generate lại).
5. `pnpm start:dev` lại.

Gộp nhanh: `git pull && pnpm install && npx prisma migrate dev && pnpm start:dev` (nhớ tắt server cũ trước).

## Bắt đầu tính năng mới

- Trước khi code: `git checkout develop && git pull` để lấy code mới nhất, sau đó tạo branch mới từ `develop` với tên phù hợp tính năng đang làm (`feature/<mo-ta-ngan>`, `fix/<mo-ta-ngan>`) — không code thẳng trên `develop`.
- Trong lúc code tính năng mới (không phải việc soát lại sau khi xong) — đây là lúc quyết định code có bug/khó maintain hay không: bám sát đúng quy ước ở các mục trên (cấu trúc module, DTO validation, xử lý lỗi, auth/phân quyền, Prisma...) ngay từ dòng code đầu tiên; xử lý đủ edge case liên quan tính năng (input rỗng/thiếu field, resource không tồn tại, race condition khi nhiều request cùng sửa 1 record...) thay vì để lại TODO xử lý sau. Mục tiêu: code không bug, logic đúng, dễ maintain, không lặp code.
- Trước khi viết 1 hàm/helper mới: rà lại codebase xem đã có sẵn cái làm việc tương tự chưa (grep trong `src/common/utils/`, module liên quan) — có thì dùng lại, không viết mới. Trong lúc code, nếu thấy 1 hàm sắp viết ra nhiều khả năng còn dùng lại ở module khác (không phải chỉ đoán, mà thấy rõ lý do — vd logic không phụ thuộc riêng 1 model) thì viết thẳng vào `src/common/utils/` ngay từ đầu, không đợi phát hiện trùng lặp rồi mới refactor sau.
- Sau khi code xong, trước khi báo hoàn thành/mở PR: chủ động tự review lại toàn bộ diff theo đúng quy ước trong `CLAUDE.md` này và `README.md` của repo — không chỉ dựa vào lint/build pass.

## Trước khi mở PR

1. `pnpm --filter @clothing-shop/be lint` — 0 lỗi.
2. `pnpm --filter @clothing-shop/be build` — build qua.
3. Nếu đổi schema: đã tạo migration và test `prisma migrate dev` chạy sạch từ đầu (không chỉ chạy được trên máy đã có data cũ).
