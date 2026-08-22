# Mở rộng luồng trạng thái đơn hàng + email thông báo khách hàng

**Ngày:** 2026-08-22
**Repo liên quan:** backend-cms (sở hữu schema), backend-user (gửi email), frontend-admin (UI)

## Mục tiêu

Luồng trạng thái đơn hiện tại (`PENDING → CONFIRMED → SHIPPING → COMPLETED`, + `CANCELLED`)
gộp chung "đóng gói" và "bàn giao vận chuyển" vào 1 bước `SHIPPING`, không khớp quy trình
vận hành thật. Mở rộng thành `PENDING → CONFIRMED → PACKING → HANDED_OVER → SHIPPING →
COMPLETED`, và mỗi lần đổi trạng thái tự động gửi email báo khách hàng.

## 1. Schema (backend-cms sở hữu)

`OrderStatus` enum thêm `PACKING`, `HANDED_OVER`, chèn giữa `CONFIRMED` và `SHIPPING`:

```prisma
enum OrderStatus {
  PENDING
  CONFIRMED
  PACKING
  HANDED_OVER
  SHIPPING
  COMPLETED
  CANCELLED
}
```

Không backfill dữ liệu cũ — đơn đang ở `CONFIRMED`/`SHIPPING` giữ nguyên, chỉ áp dụng luồng
mới cho các lần chuyển tiếp từ giờ trở đi.

## 2. Luật chuyển trạng thái (`ORDER_STATUS_TRANSITIONS`, mirror ở BE + FE)

```
PENDING     → [CONFIRMED, CANCELLED]
CONFIRMED   → [PACKING, CANCELLED]
PACKING     → [HANDED_OVER, CANCELLED]
HANDED_OVER → [SHIPPING, CANCELLED]
SHIPPING    → [COMPLETED, CANCELLED]
COMPLETED   → []
CANCELLED   → []
```

`CANCELLED` cho phép từ mọi trạng thái trước `SHIPPING` (đã hủy hoàn kho + validate note bắt
buộc — logic đã có sẵn, generic theo `order.items`, không cần sửa gì thêm ngoài transitions).

## 3. backend-cms: gọi thông báo sau khi đổi trạng thái

Trong `OrdersService.updateStatus()`, ngay sau `$transaction` commit thành công, gọi
`notifyCustomerStatusChange(orderCode, status, note)` — dùng `fetch()` thẳng (theo đúng
pattern `ghn-client.service.ts` bên backend-user, không thêm dependency HTTP client mới).
**Không `await` trước khi return** — chỉ `.catch(err => logger.error(...))`, lỗi mạng/SMTP
không bao giờ làm hỏng response `PATCH /orders/:id/status`. Không retry ở bản đầu.

Config mới (`ConfigService`, có default dev hợp lý):
- `BACKEND_USER_BASE_URL` (default `http://localhost:3001`)
- `INTERNAL_NOTIFY_KEY` (secret dùng chung giữa 2 backend, không có default — rỗng thì bỏ
  qua gọi thông báo, log warning, không throw)

## 4. backend-user: module `internal/` mới

Tách hẳn khỏi `OrdersModule` hiện có (không dùng chung `OrdersController` vì class đó đang
`@UseGuards(JwtAuthGuard)` ở mức class — thêm guard khác vào 1 method sẽ AND lại, sai ngữ
nghĩa cho 1 endpoint server-to-server không có JWT khách hàng).

```
src/modules/internal/
├── internal.module.ts       # imports OrdersModule (dùng lại OrdersService đã export)
├── internal-orders.controller.ts
└── dto/notify-order-status.dto.ts   # { status: OrderStatus; note?: string }
```

- Route: `POST /internal/orders/:orderCode/status-notification`
- Guard mới `src/common/guards/internal-api-key.guard.ts` — so khớp header `x-internal-key`
  với `INTERNAL_NOTIFY_KEY`, `UnauthorizedException` nếu thiếu/sai.
- Body **chỉ** `{ status, note? }` — **không** nhận email/tên khách từ backend-cms. Endpoint
  tự tra `Order` + `User` qua Prisma (chung DB) theo `orderCode` để lấy email/tên thật, tránh
  để caller tự quyết định gửi email đi đâu (an toàn hơn nếu secret rò rỉ).
- Thêm `OrdersService.notifyStatusChange(orderCode, status, note)` (backend-user) — tra order,
  400 nếu không tìm thấy `NotFoundException`, gọi `MailService.sendOrderStatusUpdateEmail()`.
- 1 template chung `orderStatusUpdateEmailTemplate(data)` trong `email.templates.ts` — tiêu
  đề/mô tả đổi theo `status` (map nhãn tiếng Việt local trong file này, theo đúng pattern
  `PAYMENT_METHOD_LABEL` đã có sẵn). Có `note` (chủ yếu khi `CANCELLED`) thì hiện thêm dòng lý
  do trong email.

## 5. frontend-admin

- `ORDER_STATUS_LABEL` thêm `PACKING` ("Đang đóng gói"), `HANDED_OVER` ("Đã bàn giao vận
  chuyển").
- `ORDER_STATUS_ACTION` thêm `PACKING` ("Đóng gói đơn"/"Đóng gói đơn hàng"), `HANDED_OVER`
  ("Bàn giao vận chuyển"/"Bàn giao đơn cho vận chuyển").
- `ORDER_STATUS_TRANSITIONS` mirror lại đúng bảng ở mục 2.
- Không cần đổi UI component nào khác — nút hành động theo ngữ cảnh ở `OrderDetail.tsx` đã
  generic theo `ORDER_STATUS_TRANSITIONS`/`ORDER_STATUS_ACTION`, tự hoạt động đúng với state
  mới.

## 6. Test

- backend-cms: unit test `notifyCustomerStatusChange` được gọi đúng tham số (mock `fetch`),
  test lỗi fetch không làm `updateStatus` throw; cập nhật test transitions cho 2 state mới.
- backend-user: unit + e2e cho endpoint mới (auth đúng/sai key, lookup đúng email, gọi đúng
  `MailService`, 404 khi orderCode không tồn tại).

## Ngoài phạm vi

- Không có retry/queue cho email gửi thất bại (fire-and-forget, log lỗi).
- Không backfill trạng thái đơn cũ.
- Không đổi cấu trúc `OrderStatusHistory` — vẫn ghi như hiện tại, không thêm cột nào cho việc
  gửi email (không cần track đã gửi mail hay chưa ở bản đầu).
