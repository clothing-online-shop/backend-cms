import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ImportStockDto {
  @ApiProperty({ example: 50, description: 'Số lượng nhập, cộng dồn vào tồn hiện tại' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Nhập từ nhà cung cấp ABC, lô tháng 8' })
  @IsOptional()
  @IsString()
  note?: string;
}
