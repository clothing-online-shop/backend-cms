import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class ReorderPopupItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsInt()
  sortOrder!: number;
}

export class ReorderPopupsDto {
  @ApiProperty({ type: [ReorderPopupItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderPopupItemDto)
  items!: ReorderPopupItemDto[];
}
