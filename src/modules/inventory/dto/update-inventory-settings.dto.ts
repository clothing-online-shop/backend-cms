import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateInventorySettingsDto {
  @ApiProperty({
    example: 5,
    description: 'Ngưỡng tồn kho để coi là "sắp hết hàng"',
  })
  @IsInt()
  @Min(0)
  lowStockThreshold!: number;
}
