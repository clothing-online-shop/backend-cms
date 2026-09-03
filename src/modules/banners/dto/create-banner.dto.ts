import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBannerDto {
  @ApiPropertyOptional({ example: 'BỘ SƯU TẬP THU 2026' })
  @IsOptional()
  @IsString()
  eyebrow?: string;

  @ApiProperty({ example: 'Sale mùa hè 2026' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: 'Ưu đãi tới 50% cho bộ sưu tập mới' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'URL ảnh, upload qua /upload/image' })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ description: 'publicId Cloudinary của ảnh, đi kèm imageUrl' })
  @IsString()
  imagePublicId!: string;

  @ApiPropertyOptional({
    description: 'Link đích khi click banner (CTA chính)',
  })
  @IsOptional()
  @IsString()
  linkUrl?: string;

  @ApiPropertyOptional({ example: 'Xem thêm', description: 'Nhãn nút CTA phụ' })
  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @ApiPropertyOptional({ description: 'Link đích khi bấm CTA phụ' })
  @IsOptional()
  @IsString()
  ctaLinkUrl?: string;

  @ApiPropertyOptional({ description: 'Bỏ trống mặc định 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  endDate!: string;
}
