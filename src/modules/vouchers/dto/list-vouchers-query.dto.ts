import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import { Type } from 'class-transformer';
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
  // Query param HTTP luôn là string ("0"/"1") — ép sang number trước khi IsEnum kiểm tra
  // khớp giá trị enum số, giống pattern list-products-query.dto.ts (ProductStatus).
  @Type(() => Number)
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;
}
