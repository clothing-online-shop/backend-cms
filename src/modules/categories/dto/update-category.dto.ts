import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

// Bỏ IsUrl() ở 4 field ảnh (giống lý do image cũ) — cho phép gửi null để xoá ảnh, IsUrl()
// không nhận null nên phải override lại bằng IsString() thuần ở DTO update.
export class UpdateCategoryDto extends PartialType(
  OmitType(CreateCategoryDto, [
    'image',
    'megaMenuLeftImageUrl',
    'megaMenuRightImageUrl',
    'bannerImageUrl',
  ] as const),
) {
  @ApiPropertyOptional({
    description:
      'URL ảnh danh mục. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  image?: string | null;

  @ApiPropertyOptional({
    description:
      'Ảnh look bên trái. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  megaMenuLeftImageUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Ảnh look bên phải. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  megaMenuRightImageUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Ảnh nền banner. Bỏ trống field này = giữ nguyên ảnh hiện có; gửi null = xoá ảnh',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  bannerImageUrl?: string | null;
}
