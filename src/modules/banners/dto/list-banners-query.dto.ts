import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListBannersQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tiêu đề (contains, không phân biệt hoa thường)',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
