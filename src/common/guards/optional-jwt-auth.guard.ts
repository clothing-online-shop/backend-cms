import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser | false,
  ): TUser | null {
    return user || null;
  }
}
