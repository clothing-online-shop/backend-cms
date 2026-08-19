import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GhnClient } from '../../common/ghn/ghn-client.service';
import { mapWithConcurrency } from '../../common/utils/concurrency.util';

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

  // GHN không công bố rate limit cứng cho master-data — chạy song song có giới hạn
  // (worker pool, xem mapWithConcurrency) thay vì tuần tự từng request như trước (mất vài
  // phút vì gọi ~800 request GHN nối tiếp nhau). Test thực tế với CONCURRENCY=5 trên
  // ~63 tỉnh/~700 quận/~11000 phường không bị 429.
  private readonly CONCURRENCY = 5;

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

  // Đây là thao tác Admin chủ động bấm, không nằm trong luồng người dùng cuối nên chấp
  // nhận block request tới khi xong, không cần hàng đợi/job nền.
  async syncFromGhn(): Promise<SyncResult> {
    // Cùng kiểu dữ liệu `data: null` như district/ward (xem comment ở dưới) — ép về [] để
    // không crash khi GHN trả rỗng cho master-data tỉnh.
    const provinces =
      (await this.ghnClient.get<GhnProvince[] | null>(
        '/master-data/province',
      )) ?? [];

    const savedProvinces = await mapWithConcurrency(
      provinces,
      this.CONCURRENCY,
      (province) =>
        this.prisma.province.upsert({
          where: { ghnId: province.ProvinceID },
          create: { ghnId: province.ProvinceID, name: province.ProvinceName },
          update: { name: province.ProvinceName },
        }),
    );
    const provinceIdByGhnId = new Map(
      savedProvinces.map((p) => [p.ghnId, p.id]),
    );

    // GHN trả `data: null` (không phải mảng rỗng) khi tỉnh đó không có quận con nào —
    // ép về [] để không crash bước gộp bên dưới.
    const districtsByProvince = await mapWithConcurrency(
      provinces,
      this.CONCURRENCY,
      async (province) => {
        const districts =
          (await this.ghnClient.post<GhnDistrict[] | null>(
            '/master-data/district',
            { province_id: province.ProvinceID },
          )) ?? [];
        this.logger.log(
          `Tỉnh "${province.ProvinceName}": ${districts.length} quận/huyện`,
        );
        return districts;
      },
    );
    // ProvinceID của từng district lẽ ra luôn khớp 1 tỉnh vừa lưu ở trên (vì districts được
    // lấy đúng theo province_id của các tỉnh đó), nhưng đây là dữ liệu từ API ngoài (GHN) —
    // không giả định chắc chắn khớp. Lookup miss thì bỏ qua + log thay vì crash cả API bằng
    // lỗi Prisma khó hiểu (provinceId: undefined) sau khi đã tốn hết các lượt gọi GHN trước đó.
    const allDistricts = districtsByProvince.flat().filter((district) => {
      const matched = provinceIdByGhnId.has(district.ProvinceID);
      if (!matched) {
        this.logger.warn(
          `Bỏ qua quận/huyện "${district.DistrictName}" (ID ${district.DistrictID}) — ProvinceID ${district.ProvinceID} không khớp tỉnh nào vừa đồng bộ.`,
        );
      }
      return matched;
    });

    const savedDistricts = await mapWithConcurrency(
      allDistricts,
      this.CONCURRENCY,
      (district) =>
        this.prisma.district.upsert({
          where: { ghnId: district.DistrictID },
          create: {
            ghnId: district.DistrictID,
            provinceId: provinceIdByGhnId.get(district.ProvinceID)!,
            name: district.DistrictName,
          },
          update: {
            name: district.DistrictName,
            provinceId: provinceIdByGhnId.get(district.ProvinceID)!,
          },
        }),
    );
    const districtIdByGhnId = new Map(
      savedDistricts.map((d) => [d.ghnId, d.id]),
    );

    const wardsByDistrict = await mapWithConcurrency(
      allDistricts,
      this.CONCURRENCY,
      async (district) =>
        (await this.ghnClient.post<GhnWard[] | null>('/master-data/ward', {
          district_id: district.DistrictID,
        })) ?? [],
    );
    const allWards = wardsByDistrict.flat().filter((ward) => {
      const matched = districtIdByGhnId.has(ward.DistrictID);
      if (!matched) {
        this.logger.warn(
          `Bỏ qua phường/xã "${ward.WardName}" (mã ${ward.WardCode}) — DistrictID ${ward.DistrictID} không khớp quận/huyện nào vừa đồng bộ.`,
        );
      }
      return matched;
    });

    await mapWithConcurrency(allWards, this.CONCURRENCY, (ward) =>
      this.prisma.ward.upsert({
        where: { ghnCode: ward.WardCode },
        create: {
          ghnCode: ward.WardCode,
          districtId: districtIdByGhnId.get(ward.DistrictID)!,
          name: ward.WardName,
        },
        update: {
          name: ward.WardName,
          districtId: districtIdByGhnId.get(ward.DistrictID)!,
        },
      }),
    );

    return {
      provinces: provinces.length,
      districts: allDistricts.length,
      wards: allWards.length,
    };
  }
}
