import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class AssignProductsDto {
  @ApiProperty({
    type: [String],
    description:
      'Danh sách id sản phẩm — thay thế toàn bộ danh sách hiện có (mảng rỗng = gỡ hết sản phẩm khỏi bộ sưu tập)',
  })
  @IsArray()
  @IsString({ each: true })
  productIds!: string[];
}
