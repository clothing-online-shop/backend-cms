import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';
export class CreateProductVariantDto {
  @ApiProperty({ example: 'M' }) @IsString() size!: string;
  @ApiProperty({ example: 'Đen' }) @IsString() color!: string;
  @ApiPropertyOptional({ description: 'Bỏ trống để tự sinh' })
  @IsOptional()
  @IsString()
  sku?: string;
  @ApiPropertyOptional({ description: 'Mặc định = basePrice nếu bỏ trống' })
  @IsOptional()
  @IsPositive()
  price?: number;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() imageUrl?:
    string | null;
}
export class UpdateProductVariantDto extends CreateProductVariantDto {
  @ApiPropertyOptional({
    description: 'Có id => cập nhật variant hiện có; không có => tạo mới',
  })
  @IsOptional()
  @IsString()
  id?: string;
}
