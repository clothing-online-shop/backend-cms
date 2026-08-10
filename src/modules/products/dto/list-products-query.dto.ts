import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { ProductStatus } from '../product-status.enum';

export const PRODUCT_SORT_VALUES = [
  'price_asc',
  'price_desc',
  'newest',
  'best_selling',
] as const;

export type ProductSort = (typeof PRODUCT_SORT_VALUES)[number];

export class ListProductsQueryDto {
  @ApiPropertyOptional({ description: 'Slug hoặc id danh mục' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Lọc theo id thương hiệu' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({
    description:
      'Lọc theo id bộ sưu tập — có thể truyền nhiều id cách nhau bởi dấu phẩy',
  })
  @IsOptional()
  @IsString()
  collectionIds?: string;

  @ApiPropertyOptional({
    enum: ProductStatus,
    description: 'Chỉ áp dụng khi gọi kèm token Admin',
  })
  @IsOptional()
  @Type(() => Number)
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ enum: PRODUCT_SORT_VALUES })
  @IsOptional()
  @IsIn(PRODUCT_SORT_VALUES)
  sort?: ProductSort;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  // Kiểu string (không phải boolean) — so sánh === 'true' ở service, tránh
  // class-transformer Boolean("false") === true (mọi chuỗi khác rỗng đều truthy).
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Lấy cả sản phẩm đã xóa mềm — chỉ dùng nội bộ (vd nạp lại danh sách sản phẩm ĐANG gán cho 1 bộ sưu tập để không vô tình gỡ mất sản phẩm đã xóa), không dùng cho màn danh sách/chọn sản phẩm thông thường',
  })
  @IsOptional()
  @IsString()
  includeDeleted?: string;
}
