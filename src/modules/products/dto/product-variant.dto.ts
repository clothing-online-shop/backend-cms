import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductVariantDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  size!: string;

  @ApiProperty({ example: 'Đen' })
  @IsString()
  color!: string;

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

  @ApiProperty({ description: 'Khối lượng (gram) — dùng tính phí ship GHN' })
  @IsInt()
  @Min(1)
  weight?: number;

  // string | null (không chỉ string) để UpdateProductVariantDto (kế thừa bên dưới) phân
  // biệt được "không đổi" (bỏ trống field) với "gỡ ảnh" (gửi null) — xem update-product.dto.ts
  // đã áp dụng cùng convention cho brandId/salePrice.
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

export class UpdateProductVariantDto extends CreateProductVariantDto {
  @ApiPropertyOptional({
    description: 'Có id => cập nhật variant hiện có; không có => tạo mới',
  })
  @IsOptional()
  @IsString()
  id?: string;

  // Ghi đè lại weight của lớp cha: chỉ bắt buộc khi ĐANG THÊM biến thể mới (không có id)
  // trong lúc sửa sản phẩm — biến thể đã có (có id) giữ nguyên weight cũ nếu admin không
  // gửi kèm, tránh chặn việc sửa giá/ảnh của biến thể cũ chưa kịp nhập khối lượng.
  @ApiPropertyOptional({
    description:
      'Khối lượng (gram) — bắt buộc khi thêm biến thể mới, tùy chọn khi sửa biến thể đã có',
  })
  @ValidateIf((dto: UpdateProductVariantDto) => !dto.id)
  @IsInt()
  @Min(1)
  weight?: number = undefined;
}
