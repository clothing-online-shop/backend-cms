import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

export class UpdateBannerDto extends PartialType(
  OmitType(CreateBannerDto, [
    'imageUrl',
    'imagePublicId',
    'linkUrl',
    'startDate',
    'endDate',
  ] as const),
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

  @ApiPropertyOptional({
    example: '2026-06-01',
    description:
      'Bỏ trống field này = giữ nguyên; gửi null = xóa mốc, banner coi như đã bắt đầu ngay',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description:
      'Bỏ trống field này = giữ nguyên; gửi null = xóa mốc, banner chạy mãi mãi',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}
