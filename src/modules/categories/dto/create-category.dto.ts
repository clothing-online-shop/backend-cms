import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Áo nam' })
  @IsString()
  @MinLength(1)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
