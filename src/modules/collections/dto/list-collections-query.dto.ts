import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListCollectionsQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên (contains, không phân biệt hoa thường)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  // Kiểu string (không phải boolean) — so sánh === 'true' ở service, tránh
  // class-transformer Boolean("false") === true (mọi chuỗi khác rỗng đều truthy).
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Lấy cả bộ sưu tập đã xóa mềm — chỉ dùng nội bộ (vd màn xem chi tiết sản phẩm cần hiện đúng tên bộ sưu tập cũ đã xóa), không dùng cho dropdown chọn bộ sưu tập',
  })
  @IsOptional()
  @IsString()
  includeDeleted?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Chỉ lấy bộ sưu tập chưa diễn ra hoặc đang diễn ra (loại ENDED) — dùng cho nơi CHỌN bộ sưu tập để gán (vd bước gán bộ sưu tập cho sản phẩm)',
  })
  @IsOptional()
  @IsString()
  excludeEnded?: string;
}
