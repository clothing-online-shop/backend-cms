import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class ReorderBannerItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsInt()
  sortOrder!: number;
}

export class ReorderBannersDto {
  @ApiProperty({ type: [ReorderBannerItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderBannerItemDto)
  items!: ReorderBannerItemDto[];
}
