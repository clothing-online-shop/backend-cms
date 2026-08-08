import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductVariantDto } from './product-variant.dto';

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, [
    'variants',
    'brandId',
    'salePrice',
    // Gán bộ sưu tập đi qua PUT /products/:id/collections riêng (AssignCollectionsDto),
    // không PATCH chung với các field khác — tránh vô tình reset collections khi sửa
    // 1 field bất kỳ khác của sản phẩm mà quên gửi kèm collectionIds đầy đủ.
    'collectionIds',
  ] as const),
) {
  @ApiPropertyOptional({
    description:
      'id thương hiệu. Bỏ trống field này = giữ nguyên thương hiệu hiện có; gửi null = gỡ thương hiệu khỏi sản phẩm',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  brandId?: string | null;

  @ApiPropertyOptional({
    example: 249000,
    description:
      'Giá khuyến mãi, phải nhỏ hơn basePrice. Bỏ trống field này = giữ nguyên; gửi null = xóa giá khuyến mãi (không giảm giá nữa)',
    nullable: true,
  })
  @IsOptional()
  @IsPositive()
  salePrice?: number | null;

  @ApiPropertyOptional({ type: [UpdateProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductVariantDto)
  variants?: UpdateProductVariantDto[];
}
