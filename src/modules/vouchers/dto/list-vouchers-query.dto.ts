import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { VoucherStatus } from '../voucher-status.enum';

export class ListVouchersQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo mã voucher (contains, không phân biệt hoa thường)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: VoucherStatus })
  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;
}
