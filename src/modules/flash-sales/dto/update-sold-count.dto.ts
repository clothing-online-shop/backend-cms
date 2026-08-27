import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateSoldCountDto {
  @ApiProperty({ description: 'Số đã bán mới — phải <= quantityLimit của item đó' })
  @IsInt()
  @Min(0)
  soldCount!: number;
}
