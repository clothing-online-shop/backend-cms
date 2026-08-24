import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

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

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: 20,
    description:
      'Truyền số lớn (vd 1000) ở nơi cần lấy toàn bộ danh sách để làm picker/checkbox, không phải bảng phân trang thật (xem ProductCollectionsStep.tsx)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
