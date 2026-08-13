import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { InventoryService } from './inventory.service';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto';
import { ImportStockDto } from './dto/import-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ListStockHistoryQueryDto } from './dto/list-stock-history-query.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách tồn kho theo biến thể (filter/phân trang)',
  })
  findAll(@Query() query: ListInventoryQueryDto) {
    return this.inventoryService.findAll(query);
  }

  @Get('settings')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Đọc ngưỡng cảnh báo sắp hết hàng' })
  async getSettings() {
    const lowStockThreshold =
      await this.inventoryService.getLowStockThreshold();
    return { lowStockThreshold };
  }

  @Put('settings')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Sửa ngưỡng cảnh báo sắp hết hàng (Admin)' })
  async updateSettings(@Body() dto: UpdateInventorySettingsDto) {
    const lowStockThreshold = await this.inventoryService.setLowStockThreshold(
      dto.lowStockThreshold,
    );
    return { lowStockThreshold };
  }

  @Post('variants/:variantId/import')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Nhập kho (cộng dồn) cho 1 biến thể' })
  importStock(
    @Param('variantId') variantId: string,
    @Body() dto: ImportStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.import(variantId, dto, user.id);
  }

  @Post('variants/:variantId/adjust')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Xuất kho / điều chỉnh tồn kho cho 1 biến thể' })
  adjustStock(
    @Param('variantId') variantId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventoryService.adjust(variantId, dto, user.id);
  }

  @Get('history')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Lịch sử giao dịch kho (filter/phân trang)' })
  getHistory(@Query() query: ListStockHistoryQueryDto) {
    return this.inventoryService.getHistory(query);
  }
}
