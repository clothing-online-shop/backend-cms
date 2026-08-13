import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListCollectionsQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên (contains, không phân biệt hoa thường)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Chỉ lấy bộ sưu tập chưa diễn ra/đang diễn ra (loại ENDED) — dùng cho nơi chọn bộ sưu tập để gán',
  })
  @IsOptional()
  @IsString()
  excludeEnded?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Lấy cả bộ sưu tập đã xóa mềm',
  })
  @IsOptional()
  @IsString()
  includeDeleted?: string;
}
