import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

export class UpdateCategoryDto extends PartialType(
  OmitType(CreateCategoryDto, ['image'] as const),
) {
  @ApiPropertyOptional({
    description:
      'URL ảnh danh mục. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  image?: string | null;
}
