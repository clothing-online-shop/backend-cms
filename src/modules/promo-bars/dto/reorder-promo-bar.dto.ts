import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class ReorderPromoBarItemDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsInt()
  sortOrder!: number;
}

export class ReorderPromoBarDto {
  @ApiProperty({ type: [ReorderPromoBarItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderPromoBarItemDto)
  items!: ReorderPromoBarItemDto[];
}
