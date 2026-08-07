import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsPositive,
  IsString,
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
}
