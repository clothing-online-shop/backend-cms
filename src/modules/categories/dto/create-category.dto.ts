import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Áo nam' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'ao-nam',
    description: 'Bỏ trống để tự sinh từ name',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl()
  image?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Cloudinary publicId của ảnh, dùng để xóa ảnh cũ khi thay/xóa ảnh',
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
