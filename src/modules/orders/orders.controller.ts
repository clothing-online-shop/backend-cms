import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

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
}
