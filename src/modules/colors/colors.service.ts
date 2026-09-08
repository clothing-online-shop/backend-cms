import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Color, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { CreateColorDto } from './dto/create-color.dto';
import { UpdateColorDto } from './dto/update-color.dto';
import { ListColorsQueryDto } from './dto/list-colors-query.dto';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class ColorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListColorsQueryDto): Promise<Color[]> {
    const where: Prisma.ColorWhereInput = {};
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.color.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Color> {
    const color = await this.prisma.color.findUnique({ where: { id } });
    if (!color) {
      throw new NotFoundException({
        message: 'Không tìm thấy màu',
        code: ErrorCode.COLOR_NOT_FOUND,
      });
    }
    return color;
  }

  async create(dto: CreateColorDto): Promise<Color> {
    try {
      return await this.prisma.color.create({
        data: { name: dto.name, hexCode: dto.hexCode },
      });
    } catch (err) {
      throw this.mapDuplicateNameError(err);
    }
  }

  async update(id: string, dto: UpdateColorDto): Promise<Color> {
    await this.findOne(id);

    try {
      return await this.prisma.color.update({
        where: { id },
        data: { name: dto.name, hexCode: dto.hexCode },
      });
    } catch (err) {
      throw this.mapDuplicateNameError(err);
    }
  }

  async remove(id: string): Promise<void> {
    const color = await this.findOne(id);

    // Đếm qua product_variants.color (không phải colorId) — quan hệ FK tham chiếu theo tên
    // (xem schema.prisma, ProductVariant.colorRef), không có cột colorId riêng.
    const variantCount = await this.prisma.productVariant.count({
      where: { color: color.name },
    });
    if (variantCount > 0) {
      throw new ConflictException({
        message: `Không thể xóa màu vì còn ${variantCount} biến thể sản phẩm đang dùng màu này`,
        code: ErrorCode.COLOR_DELETE_BLOCKED_HAS_VARIANTS,
      });
    }

    await this.prisma.color.delete({ where: { id } });
  }

  // colors.name có @@unique (bắt buộc vì là target của FK ProductVariant.colorRef) — tạo/sửa
  // trùng tên ném P2002 thô nếu không bắt ở đây, khớp cách các module khác tự dịch lỗi
  // Prisma quen thuộc (P2003) sang exception nghiệp vụ có message tiếng Việt.
  private mapDuplicateNameError(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException({
        message: 'Tên màu đã tồn tại',
        code: ErrorCode.COLOR_NAME_ALREADY_EXISTS,
      });
    }
    return err as Error;
  }
}
