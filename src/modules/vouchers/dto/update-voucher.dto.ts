import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateVoucherDto } from './create-voucher.dto';

// Không cho sửa `code` sau khi tạo — code là định danh khách nhập tay khi checkout, đổi
// sau khi đã phát hành ra ngoài dễ gây nhầm lẫn/không áp được mã cũ đã truyền thông.
export class UpdateVoucherDto extends PartialType(
  OmitType(CreateVoucherDto, ['code'] as const),
) {}
