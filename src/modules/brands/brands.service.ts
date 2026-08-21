import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brand, Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { ListBrandsQueryDto } from './dto/list-brands-query.dto';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListBrandsQueryDto): Promise<Brand[]> {
    const where: Prisma.BrandWhereInput = {};
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.brand.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Brand> {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      throw new NotFoundException({
        message: 'Không tìm thấy thương hiệu',
        code: ErrorCode.BRAND_NOT_FOUND,
      });
    }
    return brand;
  }

  async create(dto: CreateBrandDto): Promise<Brand> {
    return this.prisma.brand.create({
      data: {
        name: dto.name,
        logo: dto.logo,
        description: dto.description,
        origin: dto.origin,
      },
    });
  }

  async update(id: string, dto: UpdateBrandDto): Promise<Brand> {
    await this.findOne(id);

    return this.prisma.brand.update({
      where: { id },
      data: {
        name: dto.name,
        logo: dto.logo,
        description: dto.description,
        origin: dto.origin,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const productCount = await this.prisma.product.count({
      where: { brandId: id },
    });
    if (productCount > 0) {
      throw new ConflictException({
        message: `Không thể xóa thương hiệu vì còn ${productCount} sản phẩm đang gắn thương hiệu này`,
        code: ErrorCode.BRAND_DELETE_BLOCKED_HAS_PRODUCTS,
      });
    }

    await this.prisma.brand.delete({ where: { id } });
  }
}
