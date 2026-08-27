import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBlogPostDto {
  @ApiProperty({ example: 'Ba cách mặc sơ mi linen qua mùa chuyển gió' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ description: 'Nội dung bài viết (rich text HTML)' })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({ description: 'URL ảnh bìa, upload qua /upload/image' })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({
    description: 'publicId Cloudinary của ảnh bìa, đi kèm coverImage',
  })
  @IsOptional()
  @IsString()
  coverImagePublicId?: string;

  @ApiPropertyOptional({ description: 'Bỏ trống mặc định false (bản nháp)' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
