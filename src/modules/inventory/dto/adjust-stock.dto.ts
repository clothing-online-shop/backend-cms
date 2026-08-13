import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

// Chỉ 2 giá trị (khác StockMovementType đầy đủ ở @prisma/client) — endpoint này KHÔNG
// nhận IMPORT (đã có route riêng) hay RETURN (chưa dùng sprint này), tách enum riêng để
// validate chặn thẳng ở tầng DTO thay vì phải check thêm điều kiện trong service.
export enum AdjustStockType {
  EXPORT = 'EXPORT',
  ADJUSTMENT = 'ADJUSTMENT',
}

export class AdjustStockDto {
  @ApiProperty({ enum: AdjustStockType })
  @IsEnum(AdjustStockType)
  type!: AdjustStockType;

  @ApiPropertyOptional({ description: 'Bắt buộc khi type=EXPORT — số lượng xuất' })
  @ValidateIf((o: AdjustStockDto) => o.type === AdjustStockType.EXPORT)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Bắt buộc khi type=ADJUSTMENT — số tồn thực tế đếm được',
  })
  @ValidateIf((o: AdjustStockDto) => o.type === AdjustStockType.ADJUSTMENT)
  @IsInt()
  @Min(0)
  actualQuantity?: number;

  @ApiProperty({ example: 'Kiểm kê phát hiện thiếu hàng' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
