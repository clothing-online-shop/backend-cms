import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Áo nam' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'ao-nam',
    description: 'Bỏ trống để tự sinh từ name',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl()
  image?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Cloudinary publicId của ảnh, dùng để xóa ảnh cũ khi thay/xóa ảnh',
  })
  @IsOptional()
  @IsString()
  imagePublicId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Hiện danh mục này trong mục "Hàng mới về" ở mega menu của danh mục gốc chứa nó (chỉ có tác dụng với danh mục cấp 2/3)',
  })
  @IsOptional()
  @IsBoolean()
  showInNewArrivals?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Hiện danh mục này trong mục "Sale corner" ở mega menu của danh mục gốc chứa nó (chỉ có tác dụng với danh mục cấp 2/3)',
  })
  @IsOptional()
  @IsBoolean()
  showInSaleCorner?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Ảnh "look" bên trái mega menu — chỉ có tác dụng với danh mục gốc (không có cha)',
  })
  @IsOptional()
  @IsUrl()
  megaMenuLeftImageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  megaMenuLeftImagePublicId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Ảnh "look" bên phải mega menu — chỉ có tác dụng với danh mục gốc (không có cha)',
  })
  @IsOptional()
  @IsUrl()
  megaMenuRightImageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  megaMenuRightImagePublicId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Ảnh nền banner ở đầu trang danh mục trên website (chữ tiêu đề đè lên trên ảnh)',
  })
  @IsOptional()
  @IsUrl()
  bannerImageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  bannerImagePublicId?: string | null;
}
