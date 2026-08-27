import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FlashSaleItemInputDto } from './flash-sale-item-input.dto';

export class CreateFlashSaleDto {
  @ApiProperty({ example: 'Flash Sale 12.12' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '2026-12-12T00:00:00.000Z' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-12-12T02:00:00.000Z' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({
    type: [FlashSaleItemInputDto],
    description: 'Danh sách sản phẩm/biến thể tham gia — ít nhất 1 dòng',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlashSaleItemInputDto)
  items!: FlashSaleItemInputDto[];
}
