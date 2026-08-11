import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Không override thì AuthGuard mặc định ném UnauthorizedException() rỗng — NestJS tự
  // điền message "Unauthorized" (tiếng Anh) cho mọi route dùng guard này (thiếu/hết hạn/
  // sai token). Override để trả message tiếng Việt nhất quán với các lỗi auth khác.
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser {
    if (!user) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn hoặc không hợp lệ, vui lòng đăng nhập lại.',
      );
    }
    return user;
  }
}
