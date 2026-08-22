import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Trạng thái mới muốn chuyển sang',
  })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({
    description: 'Ghi chú/lý do đổi trạng thái (vd lý do hủy đơn) — tuỳ chọn',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
