import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePromoBarDto {
  @ApiProperty({ example: 'Thu 2026' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty({ example: 'Giảm 30 – 50%' })
  @IsString()
  @MinLength(1)
  highlight!: string;

  @ApiProperty({
    description: 'Link đích khi click vào cả thanh',
    example: '/san-pham',
  })
  @IsString()
  @MinLength(1)
  linkUrl!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống mặc định 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ example: '2026-08-11' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-08-23' })
  @IsDateString()
  endDate!: string;
}
