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
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Danh sách sản phẩm (filter/sort/phân trang)',
    description:
      'Khách xem chỉ thấy sản phẩm ACTIVE. Gửi kèm Bearer token của admin để xem tất cả trạng thái.',
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
    name: 'status',
    required: false,
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
    description: 'Chỉ áp dụng khi gọi kèm token Admin',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['price_asc', 'price_desc', 'newest', 'best_selling'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Danh sách sản phẩm kèm meta phân trang',
  })
  findAll(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.productsService.findAll(query, user?.role === UserRole.ADMIN);
  }

  @Get(':slug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Chi tiết sản phẩm theo slug (kèm variants, sản phẩm liên quan)',
  })
  findBySlug(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.productsService.findBySlug(slug, user?.role === UserRole.ADMIN);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Tạo sản phẩm mới kèm variants (Admin)' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cập nhật sản phẩm + đồng bộ lại variants (Admin)' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Soft delete sản phẩm (chuyển status INACTIVE) (Admin)',
  })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Patch(':id/variants/:variantId/stock')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cập nhật nhanh tồn kho 1 variant (Admin)' })
  updateVariantStock(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateStockDto,
  ) {
    return this.productsService.updateVariantStock(id, variantId, dto);
  }
}
