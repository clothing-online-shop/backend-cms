import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateBrandDto } from './create-brand.dto';

export class UpdateBrandDto extends PartialType(
  OmitType(CreateBrandDto, ['logo', 'description', 'origin'] as const),
) {
  @ApiPropertyOptional({
    description:
      'URL logo. Bỏ trống field này = giữ nguyên logo hiện có; gửi null = xoá logo',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  logo?: string | null;

  @ApiPropertyOptional({
    description: 'Bỏ trống field này = giữ nguyên; gửi null = xoá mô tả',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    example: 'Nhật Bản',
    description: 'Bỏ trống field này = giữ nguyên; gửi null = xoá xuất xứ',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  origin?: string | null;
}
