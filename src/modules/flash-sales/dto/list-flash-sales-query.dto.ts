import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { DateRangeStatus } from '../../../common/utils/date.util';

// DateRangeStatus là union string thuần (không phải Prisma enum thật) — dùng @IsIn với mảng
// hằng số thay vì @IsEnum (chỉ nhận enum/object thật).
const DATE_RANGE_STATUSES = ['UPCOMING', 'RUNNING', 'ENDED'] as const;

export class ListFlashSalesQueryDto {
  @ApiPropertyOptional({ description: 'Tìm theo tên (contains, không phân biệt hoa thường)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: DATE_RANGE_STATUSES })
  @IsOptional()
  @IsIn(DATE_RANGE_STATUSES)
  status?: DateRangeStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
