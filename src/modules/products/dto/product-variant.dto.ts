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
  // `?` (không phải `!`) chỉ vì TS không cho subclass nới kiểu number thành
  // number | undefined (TS2416) khi UpdateProductVariantDto ghi đè bên dưới —
  // field này vẫn bắt buộc runtime qua @IsInt()/@Min(1), không có @IsOptional().
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

  // Ghi đè lại weight của lớp cha: bắt buộc khi ĐANG THÊM biến thể mới (không có id)
  // trong lúc sửa sản phẩm; khi sửa biến thể đã có (có id) thì không bắt buộc gửi lại,
  // nhưng NẾU có gửi kèm vẫn phải validate (tránh weight: 0/-500/"500" ghi đè âm thầm
  // giá trị cũ hợp lệ — 0 không phải nullish nên `item.weight ?? current.weight` trong
  // syncVariants sẽ dùng luôn 0 nếu không validate ở đây).
  // `= undefined`: bắt buộc phải có initializer vì tsconfig bật useDefineForClassFields
  // (kéo theo bởi target ES2023), nếu không redeclare field không initializer sẽ lỗi
  // TS2612 — đây không phải dead code, đừng xoá.
  // Lưu ý: class-validator bỏ metadata validator kế thừa khi subclass redeclare cùng
  // property với decorator cùng loại — nếu sau này thêm @Max(...) cho weight ở lớp cha
  // thì phải thêm lại ở đây, chỉ sửa lớp cha sẽ không có tác dụng.
  @ApiPropertyOptional({
    description:
      'Khối lượng (gram) — bắt buộc khi thêm biến thể mới, tùy chọn khi sửa biến thể đã có',
  })
  @ValidateIf(
    (dto: UpdateProductVariantDto) => !dto.id || dto.weight !== undefined,
  )
  @IsInt()
  @Min(1)
  weight?: number = undefined;
}
