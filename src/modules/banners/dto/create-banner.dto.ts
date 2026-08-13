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
  @ApiProperty({ example: 'Sale mùa hè 2026' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ description: 'URL ảnh, upload qua /upload/image' })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ description: 'publicId Cloudinary của ảnh, đi kèm imageUrl' })
  @IsString()
  imagePublicId!: string;

  @ApiPropertyOptional({ description: 'Link đích khi click banner' })
  @IsOptional()
  @IsString()
  linkUrl?: string;

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
