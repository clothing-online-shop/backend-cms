import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVoucherDto {
  @ApiProperty({ example: 'SUMMER2026' })
  @IsString()
  @MinLength(3)
  code!: string;

  @ApiPropertyOptional({
    description: 'Ảnh minh họa voucher, upload qua /upload/image',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'publicId Cloudinary của ảnh, đi kèm imageUrl',
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @ApiProperty({
    description: 'PERCENTAGE: 0-100 (%). FIXED_AMOUNT: số tiền giảm trực tiếp.',
    example: 10,
  })
  @IsNumber()
  @IsPositive()
  discountValue!: number;

  @ApiPropertyOptional({
    description:
      'Trần số tiền được giảm — chỉ áp dụng khi discountType=PERCENTAGE.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxDiscountAmount?: number;

  @ApiPropertyOptional({
    description: 'Giá trị đơn tối thiểu để áp mã, mặc định 0',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @ApiProperty({
    description: 'Bắt buộc chọn — không còn khái niệm "hiệu lực ngay".',
  })
  @IsDateString()
  startsAt!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống = không giới hạn thời hạn' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Tổng số lượt dùng tối đa, bỏ trống = không giới hạn',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  usageLimit?: number;

  @ApiPropertyOptional({
    description: 'Số lượt dùng tối đa/khách, bỏ trống = không giới hạn',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  perCustomerLimit?: number;

  @ApiPropertyOptional({
    description: 'Bỏ trống mặc định true (đang hoạt động)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
