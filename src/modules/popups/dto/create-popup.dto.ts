import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePopupDto {
  @ApiPropertyOptional({ example: 'ƯU ĐÃI THÁNG 8' })
  @IsOptional()
  @IsString()
  eyebrow?: string;

  @ApiProperty({ example: 'Giảm 15% đơn từ 800.000đ' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({
    example: 'Nhập mã THU26 ở bước thanh toán, hạn dùng đến 31.08.2026.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'THU26' })
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiProperty({ description: 'URL ảnh, upload qua /upload/image' })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ description: 'publicId Cloudinary của ảnh, đi kèm imageUrl' })
  @IsString()
  imagePublicId!: string;

  @ApiProperty({ example: 'Mua sắm ngay' })
  @IsString()
  @MinLength(1)
  ctaLabel!: string;

  @ApiProperty({ description: 'Link đích khi bấm CTA' })
  @IsString()
  ctaLinkUrl!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống mặc định 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  endDate!: string;
}
