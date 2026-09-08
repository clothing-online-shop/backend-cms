import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsString, MinLength } from 'class-validator';

export class CreateColorDto {
  @ApiProperty({ example: 'Đen', description: 'Tên màu — phải là duy nhất' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '#1a1a1a', description: 'Mã màu hex, dạng #rrggbb' })
  @IsHexColor()
  hexCode!: string;
}
