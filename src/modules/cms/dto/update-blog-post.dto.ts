import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateBlogPostDto } from './create-blog-post.dto';

export class UpdateBlogPostDto extends PartialType(
  OmitType(CreateBlogPostDto, ['coverImage', 'coverImagePublicId'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Bỏ trống cả coverImage và coverImagePublicId = giữ ảnh hiện có; nếu gửi phải gửi kèm cả 2 (ảnh không thể xóa về rỗng)',
  })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({
    description: 'publicId Cloudinary của ảnh bìa mới, đi kèm coverImage',
  })
  @IsOptional()
  @IsString()
  coverImagePublicId?: string;
}
