import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GhnResponse<T> {
  code: number;
  message: string;
  data: T;
}

// Client dùng chung cho mọi lần gọi API GHN (master-data Tỉnh/Quận/Phường hiện tại — sau
// này tạo đơn vận chuyển/tính phí thật cũng gọi qua đây) — tách khỏi LocationsService để
// module vận chuyển sau này dùng lại được, không viết lại phần header/base URL/parse lỗi.
@Injectable()
export class GhnClient {
  private readonly logger = new Logger(GhnClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'GHN_API_BASE_URL',
      'https://dev-online-gateway.ghn.vn/shiip/public-api',
    );
    this.token = this.config.get<string>('GHN_API_TOKEN', '');
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.token) {
      throw new InternalServerErrorException(
        'Chưa cấu hình GHN_API_TOKEN — không thể gọi API GHN.',
      );
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Token: this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      // Log nguyên văn body lỗi GHN trả về (server-side only, không lộ ra response cho
      // client) — nếu không log lại thì mất luôn manh mối khi GHN đổi API/trả lỗi mới.
      const errorBody = await response.text().catch(() => '');
      this.logger.error(
        `GHN API lỗi ${response.status}: ${method} ${path} — ${errorBody}`,
      );
      throw new InternalServerErrorException('Không gọi được API GHN.');
    }

    const result = (await response.json()) as GhnResponse<T>;
    if (result.code !== 200) {
      // GHN có thể trả HTTP 200 kèm lỗi nghiệp vụ trong body (token sai, tham số không hợp
      // lệ...) — response.ok vẫn true nên phải tự kiểm tra `code`, không thì lỗi bị nuốt và
      // `data` (thường là null) bị coi như kết quả hợp lệ.
      this.logger.error(
        `GHN API trả lỗi nghiệp vụ: ${method} ${path} — code=${result.code} message=${result.message}`,
      );
      throw new InternalServerErrorException('Không gọi được API GHN.');
    }
    return result.data;
  }
}
