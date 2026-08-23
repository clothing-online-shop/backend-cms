import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateVoucherDto } from './create-voucher.dto';

// Không cho sửa `code` sau khi tạo — code là định danh khách nhập tay khi checkout, đổi
// sau khi đã phát hành ra ngoài dễ gây nhầm lẫn/không áp được mã cũ đã truyền thông.
export class UpdateVoucherDto extends PartialType(
  OmitType(CreateVoucherDto, ['code', 'imageUrl', 'imagePublicId'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Bỏ trống = giữ ảnh hiện có; gửi null = gỡ ảnh; gửi url mới = thay ảnh (phải kèm imagePublicId).',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @ApiPropertyOptional({
    description: 'publicId Cloudinary của ảnh mới, đi kèm imageUrl',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string | null;
}
