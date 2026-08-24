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
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { ListVouchersQueryDto } from './dto/list-vouchers-query.dto';

@ApiTags('vouchers')
@ApiBearerAuth()
@Controller('vouchers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách voucher (tìm theo mã, lọc theo trạng thái, phân trang)',
  })
  findAll(@Query() query: ListVouchersQueryDto) {
    return this.vouchersService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 voucher' })
  findOne(@Param('id') id: string) {
    return this.vouchersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo voucher mới (Admin, Marketing)' })
  create(@Body() dto: CreateVoucherDto) {
    return this.vouchersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật voucher (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateVoucherDto) {
    return this.vouchersService.update(id, dto);
  }

  @Patch(':id/toggle-active')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Bật/tắt nhanh voucher (Admin, Marketing)' })
  toggleActive(@Param('id') id: string) {
    return this.vouchersService.toggleActive(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Xóa voucher chưa có lượt dùng nào (Admin, Marketing)',
  })
  remove(@Param('id') id: string) {
    return this.vouchersService.remove(id);
  }
}
