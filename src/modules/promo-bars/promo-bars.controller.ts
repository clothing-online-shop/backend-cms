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
import { PromoBarsService } from './promo-bars.service';
import { CreatePromoBarDto } from './dto/create-promo-bar.dto';
import { UpdatePromoBarDto } from './dto/update-promo-bar.dto';
import { ListPromoBarQueryDto } from './dto/list-promo-bar-query.dto';
import { ReorderPromoBarDto } from './dto/reorder-promo-bar.dto';

@ApiTags('promo-bars')
@ApiBearerAuth()
@Controller('promo-bars')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromoBarsController {
  constructor(private readonly promoBarsService: PromoBarsService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách thanh khuyến mãi header (tìm theo nhãn, phân trang)',
  })
  findAll(@Query() query: ListPromoBarQueryDto) {
    return this.promoBarsService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 thanh khuyến mãi' })
  findOne(@Param('id') id: string) {
    return this.promoBarsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo thanh khuyến mãi mới (Admin, Marketing)' })
  create(@Body() dto: CreatePromoBarDto) {
    return this.promoBarsService.create(dto);
  }

  // Đặt trước @Patch(':id') — nếu để sau, request tới /promo-bars/reorder sẽ bị Nest
  // match nhầm vào update() với id = "reorder".
  @Patch('reorder')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Sắp xếp lại thứ tự ưu tiên hiển thị (Admin, Marketing)',
  })
  reorder(@Body() dto: ReorderPromoBarDto) {
    return this.promoBarsService.reorder(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật thanh khuyến mãi (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdatePromoBarDto) {
    return this.promoBarsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa thanh khuyến mãi (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.promoBarsService.remove(id);
  }
}
