import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class AssignCollectionsDto {
  @ApiProperty({
    type: [String],
    description:
      'Danh sách id bộ sưu tập — thay thế toàn bộ danh sách hiện có (mảng rỗng = gỡ khỏi mọi bộ sưu tập)',
  })
  @IsArray()
  @IsString({ each: true })
  collectionIds!: string[];
}
