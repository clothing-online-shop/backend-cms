import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreatePopupDto } from './create-popup.dto';

export class UpdatePopupDto extends PartialType(
  OmitType(CreatePopupDto, ['imageUrl', 'imagePublicId'] as const),
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
}
