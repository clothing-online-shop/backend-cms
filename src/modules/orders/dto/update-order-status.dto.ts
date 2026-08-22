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
    description:
      'Ghi chú/lý do đổi trạng thái — tuỳ chọn, RIÊNG khi status=CANCELLED thì bắt buộc (validate ở service, không phải class-validator vì phụ thuộc field status)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
