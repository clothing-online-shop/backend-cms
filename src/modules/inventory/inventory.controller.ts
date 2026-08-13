import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { InventoryService } from './inventory.service';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('settings')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Đọc ngưỡng cảnh báo sắp hết hàng' })
  async getSettings() {
    const lowStockThreshold = await this.inventoryService.getLowStockThreshold();
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
}
