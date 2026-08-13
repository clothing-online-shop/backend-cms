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
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { ListBannersQueryDto } from './dto/list-banners-query.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';

@ApiTags('banners')
@ApiBearerAuth()
@Controller('banners')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách banner trang chủ (tìm theo tiêu đề)' })
  findAll(@Query() query: ListBannersQueryDto) {
    return this.bannersService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 banner' })
  findOne(@Param('id') id: string) {
    return this.bannersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo banner mới (Admin, Marketing)' })
  create(@Body() dto: CreateBannerDto) {
    return this.bannersService.create(dto);
  }

  // Đặt trước @Patch(':id') — nếu để sau, request tới /banners/reorder sẽ bị Nest
  // match nhầm vào update() với id = "reorder".
  @Patch('reorder')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Sắp xếp lại thứ tự hiển thị banner (Admin, Marketing)',
  })
  reorder(@Body() dto: ReorderBannersDto) {
    return this.bannersService.reorder(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật banner (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.bannersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa banner (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.bannersService.remove(id);
  }
}
