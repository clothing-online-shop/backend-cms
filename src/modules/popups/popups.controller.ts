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
import { PopupsService } from './popups.service';
import { CreatePopupDto } from './dto/create-popup.dto';
import { UpdatePopupDto } from './dto/update-popup.dto';
import { ListPopupsQueryDto } from './dto/list-popups-query.dto';
import { ReorderPopupsDto } from './dto/reorder-popups.dto';

@ApiTags('popups')
@ApiBearerAuth()
@Controller('popups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PopupsController {
  constructor(private readonly popupsService: PopupsService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách popup marketing (tìm theo tiêu đề, phân trang)',
  })
  findAll(@Query() query: ListPopupsQueryDto) {
    return this.popupsService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 popup' })
  findOne(@Param('id') id: string) {
    return this.popupsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo popup mới (Admin, Marketing)' })
  create(@Body() dto: CreatePopupDto) {
    return this.popupsService.create(dto);
  }

  // Đặt trước @Patch(':id') — nếu để sau, request tới /popups/reorder sẽ bị Nest
  // match nhầm vào update() với id = "reorder".
  @Patch('reorder')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary: 'Sắp xếp lại thứ tự ưu tiên hiển thị popup (Admin, Marketing)',
  })
  reorder(@Body() dto: ReorderPopupsDto) {
    return this.popupsService.reorder(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật popup (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdatePopupDto) {
    return this.popupsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa popup (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.popupsService.remove(id);
  }
}
