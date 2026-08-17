import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { LocationsService } from './locations.service';
import { ListDistrictsQueryDto } from './dto/list-districts-query.dto';
import { ListWardsQueryDto } from './dto/list-wards-query.dto';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('provinces')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách tỉnh/thành phố (đã đồng bộ từ GHN)' })
  findProvinces() {
    return this.locationsService.findProvinces();
  }

  @Get('districts')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách quận/huyện theo tỉnh/thành phố' })
  findDistricts(@Query() query: ListDistrictsQueryDto) {
    return this.locationsService.findDistricts(query.provinceId);
  }

  @Get('wards')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách phường/xã theo quận/huyện' })
  findWards(@Query() query: ListWardsQueryDto) {
    return this.locationsService.findWards(query.districtId);
  }

  @Post('sync')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Đồng bộ toàn bộ Tỉnh/Quận/Phường từ GHN (Admin — có thể mất vài phút)',
  })
  sync() {
    return this.locationsService.syncFromGhn();
  }
}
