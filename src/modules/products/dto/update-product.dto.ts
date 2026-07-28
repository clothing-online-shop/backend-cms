import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductVariantDto } from './product-variant.dto';

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['variants'] as const),
) {
  @ApiPropertyOptional({ type: [UpdateProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductVariantDto)
  variants?: UpdateProductVariantDto[];
}
