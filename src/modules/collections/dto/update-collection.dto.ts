import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateCollectionDto } from './create-collection.dto';

export class UpdateCollectionDto extends PartialType(
  OmitType(CreateCollectionDto, [
    'banner',
    'backgroundImageUrl',
    'description',
  ] as const),
) {
  @ApiPropertyOptional({
    description:
      'URL banner. Bỏ trống field này = giữ nguyên banner hiện có; gửi null = xoá banner',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  banner?: string | null;

  @ApiPropertyOptional({
    description:
      'URL ảnh nền. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  backgroundImageUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Bỏ trống field này = giữ nguyên; gửi null = xoá mô tả',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;
}
