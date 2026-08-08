import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ListCollectionsQueryDto } from './dto/list-collections-query.dto';
import { AssignProductsDto } from './dto/assign-products.dto';

@ApiTags('collections')
@ApiBearerAuth()
@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Danh sách bộ sưu tập (tìm theo tên)' })
  findAll(@Query() query: ListCollectionsQueryDto) {
    return this.collectionsService.findAll(query);
  }

  @Get(':id')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({ summary: 'Chi tiết 1 bộ sưu tập' })
  findOne(@Param('id') id: string) {
    return this.collectionsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Tạo bộ sưu tập mới (Admin, Marketing)' })
  create(@Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Cập nhật bộ sưu tập (Admin, Marketing)' })
  update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collectionsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Xóa bộ sưu tập (Admin, Marketing)' })
  remove(@Param('id') id: string) {
    return this.collectionsService.remove(id);
  }

  @Put(':id/products')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({
    summary:
      'Gán bộ sưu tập cho danh sách sản phẩm (thay thế toàn bộ, Admin, Marketing)',
  })
  assignProducts(@Param('id') id: string, @Body() dto: AssignProductsDto) {
    return this.collectionsService.assignProducts(id, dto);
  }

  @Delete(':id/products/:productId')
  @Roles(UserRole.ADMIN, UserRole.MARKETING)
  @ApiOperation({ summary: 'Gỡ 1 sản phẩm khỏi bộ sưu tập (Admin, Marketing)' })
  removeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionsService.removeProduct(id, productId);
  }
}
