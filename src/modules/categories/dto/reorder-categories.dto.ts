import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ReorderCategoryItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsInt()
  sortOrder!: number;

  @ApiProperty({ nullable: true, required: false })
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class ReorderCategoriesDto {
  @ApiProperty({ type: [ReorderCategoryItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCategoryItemDto)
  items!: ReorderCategoryItemDto[];
}
