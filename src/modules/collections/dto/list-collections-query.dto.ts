import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListCollectionsQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên (contains, không phân biệt hoa thường)',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
