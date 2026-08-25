import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { FlashSalesService } from './flash-sales.service';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { ListFlashSalesQueryDto } from './dto/list-flash-sales-query.dto';
import { UpdateSoldCountDto } from './dto/update-sold-count.dto';
import { AddFlashSaleItemsDto } from './dto/add-flash-sale-items.dto';

@ApiTags('flash-sales')
@ApiBearerAuth()
@Controller('flash-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách Flash Sale (tìm theo tên, lọc trạng thái, phân trang)',
  })
  findAll(@Query() query: ListFlashSalesQueryDto) {
    return this.flashSalesService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 đợt Flash Sale' })
  findOne(@Param('id') id: string) {
    return this.flashSalesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo đợt Flash Sale mới (Admin, Marketing)' })
  create(@Body() dto: CreateFlashSaleDto) {
    return this.flashSalesService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật đợt Flash Sale (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateFlashSaleDto) {
    return this.flashSalesService.update(id, dto);
  }

  @Patch(':id/end-now')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Kết thúc sớm đợt Flash Sale đang diễn ra (Admin, Marketing)',
  })
  endNow(@Param('id') id: string) {
    return this.flashSalesService.endNow(id);
  }

  @Post(':id/items')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary:
      'Thêm sản phẩm vào đợt Flash Sale đang diễn ra — chỉ cộng thêm, không xóa/sửa sản phẩm đã có (Admin, Marketing)',
  })
  addItems(@Param('id') id: string, @Body() dto: AddFlashSaleItemsDto) {
    return this.flashSalesService.addItems(id, dto);
  }

  @Patch(':id/items/:itemId/sold-count')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Chỉnh tay số đã bán của 1 sản phẩm trong đợt (Admin, Marketing)',
  })
  updateSoldCount(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSoldCountDto,
  ) {
    return this.flashSalesService.updateSoldCount(id, itemId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa mềm đợt Flash Sale (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.flashSalesService.remove(id);
  }
}
