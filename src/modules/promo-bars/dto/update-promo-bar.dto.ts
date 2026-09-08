import { PartialType } from '@nestjs/swagger';
import { CreatePromoBarDto } from './create-promo-bar.dto';

export class UpdatePromoBarDto extends PartialType(CreatePromoBarDto) {}
