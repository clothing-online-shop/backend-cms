import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { FlashSaleItemInputDto } from './flash-sale-item-input.dto';

export class AddFlashSaleItemsDto {
  @ApiProperty({
    type: [FlashSaleItemInputDto],
    description:
      'Danh sách sản phẩm/biến thể muốn THÊM vào đợt đang diễn ra — ít nhất 1 dòng. Không ảnh hưởng tới sản phẩm đã có sẵn trong đợt (không xóa, không sửa).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlashSaleItemInputDto)
  items!: FlashSaleItemInputDto[];
}
