import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GhnClient } from '../../common/ghn/ghn-client.service';

interface GhnProvince {
  ProvinceID: number;
  ProvinceName: string;
}

interface GhnDistrict {
  DistrictID: number;
  ProvinceID: number;
  DistrictName: string;
}

interface GhnWard {
  WardCode: string;
  DistrictID: number;
  WardName: string;
}

export interface SyncResult {
  provinces: number;
  districts: number;
  wards: number;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ghnClient: GhnClient,
  ) {}

  findProvinces() {
    return this.prisma.province.findMany({ orderBy: { name: 'asc' } });
  }

  async findDistricts(provinceId: string) {
    const province = await this.prisma.province.findUnique({
      where: { id: provinceId },
    });
    if (!province) {
      throw new NotFoundException('Không tìm thấy tỉnh/thành phố.');
    }
    return this.prisma.district.findMany({
      where: { provinceId },
      orderBy: { name: 'asc' },
    });
  }

  async findWards(districtId: string) {
    const district = await this.prisma.district.findUnique({
      where: { id: districtId },
    });
    if (!district) {
      throw new NotFoundException('Không tìm thấy quận/huyện.');
    }
    return this.prisma.ward.findMany({
      where: { districtId },
      orderBy: { name: 'asc' },
    });
  }

  // Chạy TUẦN TỰ theo từng tỉnh → từng quận (không Promise.all song song) — tôn trọng
  // rate limit của GHN, chấp nhận việc đồng bộ toàn quốc (~63 tỉnh, ~700 quận, ~11000
  // phường) có thể mất vài phút. Đây là thao tác Admin chủ động bấm, không nằm trong luồng
  // người dùng cuối nên chấp nhận block request tới khi xong, không cần hàng đợi/job nền.
  async syncFromGhn(): Promise<SyncResult> {
    const provinces = await this.ghnClient.get<GhnProvince[]>(
      '/master-data/province',
    );

    let districtCount = 0;
    let wardCount = 0;

    for (const province of provinces) {
      const savedProvince = await this.prisma.province.upsert({
        where: { ghnId: province.ProvinceID },
        create: { ghnId: province.ProvinceID, name: province.ProvinceName },
        update: { name: province.ProvinceName },
      });

      // GHN trả `data: null` (không phải mảng rỗng) khi tỉnh/quận đó không có quận/phường
      // con nào — ép về [] để không crash vòng lặp bên dưới.
      const districts =
        (await this.ghnClient.post<GhnDistrict[] | null>(
          '/master-data/district',
          { province_id: province.ProvinceID },
        )) ?? [];

      for (const district of districts) {
        const savedDistrict = await this.prisma.district.upsert({
          where: { ghnId: district.DistrictID },
          create: {
            ghnId: district.DistrictID,
            provinceId: savedProvince.id,
            name: district.DistrictName,
          },
          update: {
            name: district.DistrictName,
            provinceId: savedProvince.id,
          },
        });
        districtCount += 1;

        const wards =
          (await this.ghnClient.post<GhnWard[] | null>('/master-data/ward', {
            district_id: district.DistrictID,
          })) ?? [];

        for (const ward of wards) {
          await this.prisma.ward.upsert({
            where: { ghnCode: ward.WardCode },
            create: {
              ghnCode: ward.WardCode,
              districtId: savedDistrict.id,
              name: ward.WardName,
            },
            update: { name: ward.WardName, districtId: savedDistrict.id },
          });
          wardCount += 1;
        }
      }

      this.logger.log(
        `Đã đồng bộ tỉnh "${province.ProvinceName}" (${districts.length} quận/huyện)`,
      );
    }

    return {
      provinces: provinces.length,
      districts: districtCount,
      wards: wardCount,
    };
  }
}
