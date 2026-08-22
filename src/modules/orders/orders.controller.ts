import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary:
      'Danh sách đơn hàng — lọc theo trạng thái/khoảng thời gian/phương thức thanh toán, tìm theo mã đơn hoặc SĐT khách, phân trang',
  })
  findAll(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary:
      'Chi tiết đơn hàng — sản phẩm, khách hàng, địa chỉ/thanh toán, lịch sử trạng thái',
  })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id/status')
  // Hẹp hơn GET (không có MARKETING) — đây là hành động có tác động thật (trừ/hoàn kho,
  // đổi paymentStatus), không phải chỉ xem để phân tích.
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({
    summary:
      'Đổi trạng thái đơn hàng — validate luồng chuyển hợp lệ, tự hoàn kho khi hủy đơn, tự đánh dấu đã thanh toán khi hoàn tất đơn COD, ghi lịch sử',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.updateStatus(id, dto, user.id);
  }

  @Patch(':id/confirm-bank-transfer')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Xác nhận đã nhận tiền chuyển khoản (Admin)' })
  confirmBankTransfer(@Param('id') id: string) {
    return this.ordersService.confirmBankTransfer(id);
  }
}
