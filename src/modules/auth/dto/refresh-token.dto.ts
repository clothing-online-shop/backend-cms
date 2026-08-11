import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString({ message: 'Refresh token không hợp lệ' })
  refreshToken: string;
}
