import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrdersService } from './orders.service';

// Chỉ có endpoint xác nhận chuyển khoản — module quản lý đơn hàng đầy đủ (danh sách/chi
// tiết/cập nhật trạng thái giao hàng...) thuộc sprint khác, chưa nằm trong phạm vi hiện tại.
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Patch(':id/confirm-bank-transfer')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Xác nhận đã nhận tiền chuyển khoản (Admin)' })
  confirmBankTransfer(@Param('id') id: string) {
    return this.ordersService.confirmBankTransfer(id);
  }
}
