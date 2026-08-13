import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

export class UpdateBannerDto extends PartialType(
  OmitType(CreateBannerDto, ['imageUrl', 'imagePublicId', 'linkUrl'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Bỏ trống cả imageUrl và imagePublicId = giữ ảnh hiện có; nếu gửi phải gửi kèm cả 2 (ảnh không thể xóa về rỗng)',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'publicId Cloudinary của ảnh mới, đi kèm imageUrl',
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string;

  @ApiPropertyOptional({
    description: 'Bỏ trống field này = giữ nguyên; gửi null = xóa link đích',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;
}
