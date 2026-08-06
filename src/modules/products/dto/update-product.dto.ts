import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductVariantDto } from './product-variant.dto';

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['variants', 'brandId'] as const),
) {
  @ApiPropertyOptional({
    description:
      'id thương hiệu. Bỏ trống field này = giữ nguyên thương hiệu hiện có; gửi null = gỡ thương hiệu khỏi sản phẩm',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  brandId?: string | null;

  @ApiPropertyOptional({ type: [UpdateProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductVariantDto)
  variants?: UpdateProductVariantDto[];
}
