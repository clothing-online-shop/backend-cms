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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ADMIN_PANEL_ROLES } from '../../common/constants/admin-panel-roles';
import { ProductStatus } from './product-status.enum';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { AssignCollectionsDto } from './dto/assign-collections.dto';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Danh sách sản phẩm (filter/sort/phân trang)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Slug hoặc id danh mục',
  })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({
    name: 'size',
    required: false,
    description:
      'Có thể truyền nhiều giá trị cách nhau bởi dấu phẩy, ví dụ: S,M',
  })
  @ApiQuery({
    name: 'color',
    required: false,
    description: 'Có thể truyền nhiều giá trị cách nhau bởi dấu phẩy',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'collectionIds',
    required: false,
    description: 'Có thể truyền nhiều id cách nhau bởi dấu phẩy',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ProductStatus,
  })
  @ApiQuery({
    name: 'isFeatured',
    required: false,
    type: Boolean,
    description: 'Lọc sản phẩm được admin gắn cờ nổi bật',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['price_asc', 'price_desc', 'newest', 'best_selling'],
    description:
      'best_selling: sắp xếp theo tổng số lượng bán trong 30 ngày gần nhất (chỉ tính đơn COMPLETED)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Danh sách sản phẩm kèm meta phân trang',
  })
  findAll(@Query() query: ListProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get(':slug')
  @Roles(...ADMIN_PANEL_ROLES)
  @ApiOperation({
    summary: 'Chi tiết sản phẩm theo slug (kèm variants, sản phẩm liên quan)',
  })
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Tạo sản phẩm mới kèm variants (Admin)' })
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Cập nhật sản phẩm + đồng bộ lại variants (Admin)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({
    summary:
      'Xóa sản phẩm — xóa mềm (giữ lịch sử đơn hàng/review), tự gỡ khỏi mọi bộ sưu tập (Admin)',
  })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Put(':id/collections')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({
    summary: 'Gán sản phẩm vào danh sách bộ sưu tập (thay thế toàn bộ)',
  })
  assignCollections(
    @Param('id') id: string,
    @Body() dto: AssignCollectionsDto,
  ) {
    return this.productsService.assignCollections(id, dto);
  }

  @Delete(':id/collections/:collectionId')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Gỡ sản phẩm khỏi 1 bộ sưu tập' })
  removeFromCollection(
    @Param('id') id: string,
    @Param('collectionId') collectionId: string,
  ) {
    return this.productsService.removeFromCollection(id, collectionId);
  }
}
