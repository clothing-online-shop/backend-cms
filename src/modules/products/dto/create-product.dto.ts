import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductStatus } from '../product-status.enum';
import { CreateProductVariantDto } from './product-variant.dto';

export class CreateProductDto {
  @ApiProperty({ example: 'Áo sơ mi nữ tay dài' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh từ name' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Cotton 100%' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'Giặt tay, không dùng thuốc tẩy' })
  @IsOptional()
  @IsString()
  careInstructions?: string;

  @ApiPropertyOptional({ description: 'id thương hiệu, xem GET /brands' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty({ example: 299000 })
  @IsPositive()
  basePrice!: number;

  @ApiPropertyOptional({
    example: 249000,
    description: 'Phải nhỏ hơn basePrice — kiểm tra ở service',
  })
  @IsOptional()
  @IsPositive()
  salePrice?: number;

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    default: false,
    description: 'Admin gắn cờ sản phẩm nổi bật',
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  thumbnail?: string;

  @ApiPropertyOptional({
    description:
      'Cloudinary publicId của thumbnail, dùng để xóa ảnh cũ khi thay ảnh',
  })
  @IsOptional()
  @IsString()
  thumbnailPublicId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Cloudinary publicId của từng ảnh trong images, cùng thứ tự — dùng để xóa ảnh cũ khi bớt ảnh',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagePublicIds?: string[];

  @ApiPropertyOptional({ example: 'Áo sơ mi nữ tay dài - Uniqlo' })
  @IsOptional()
  @IsString()
  metaTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metaDescription?: string;

  @ApiProperty({ type: [CreateProductVariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants!: CreateProductVariantDto[];

  // 3 field "mồi" số liệu hiển thị (đã bán/đánh giá) cho sản phẩm mới chưa có đơn/đánh giá
  // thật — backend-user cộng dồn với số liệu thật khi trả về công khai (xem findBySlug() +
  // buildDisplayRating() ở products.service.ts, backend-user). Không ảnh hưởng danh sách
  // đánh giá thật hay breakdown theo sao (không có nội dung review ảo).
  @ApiPropertyOptional({
    default: 0,
    description:
      'Số lượt "đã bán" ảo, cộng dồn với đơn hàng COMPLETED thật khi hiển thị',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  fakeSoldCount?: number;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Số lượt đánh giá ảo, cộng dồn với đánh giá thật khi hiển thị (không tạo review thật kèm nội dung)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  fakeReviewCount?: number;

  @ApiPropertyOptional({
    default: 0,
    example: 4.8,
    description:
      'Điểm trung bình ảo (0-5) — chỉ có ý nghĩa khi fakeReviewCount > 0',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  fakeRatingAverage?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Danh sách id bộ sưu tập gán ngay lúc tạo sản phẩm',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectionIds?: string[];
}
