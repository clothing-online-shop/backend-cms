import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, IsString } from 'class-validator';

export class FlashSaleItemInputDto {
  @ApiProperty({ description: 'Id biến thể sản phẩm (ProductVariant)' })
  @IsString()
  productVariantId!: string;

  @ApiProperty({ description: 'Giá bán trong đợt sale — phải nhỏ hơn giá gốc hiện tại' })
  @IsNumber()
  @IsPositive()
  salePrice!: number;

  @ApiProperty({ description: 'Số lượng tối đa bán với giá sale — phải <= tồn kho hiện tại' })
  @IsInt()
  @IsPositive()
  quantityLimit!: number;
}
