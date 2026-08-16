import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { UsersService } from '../users/users.service';
import { isAdminPanelRole } from '../../common/constants/admin-panel-roles';
import { toSafeUser } from '../../common/utils/safe-user.util';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    dto: LoginDto,
  ): Promise<AuthTokens & { user: Omit<User, 'password'> }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const passwordMatches = await argon2.verify(user.password, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (!isAdminPanelRole(user.role)) {
      throw new UnauthorizedException('Tài khoản không có quyền quản trị');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản đã bị khóa hoặc vô hiệu hóa');
    }

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toSafeUser(user) };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>(
          'JWT_REFRESH_SECRET',
          'change-me-refresh-secret',
        ),
      });
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ.');
    }

    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    let matchedTokenId: string | null = null;
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, refreshToken)) {
        matchedTokenId = candidate.id;
        break;
      }
    }

    if (!matchedTokenId) {
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã bị thu hồi.',
      );
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !isAdminPanelRole(user.role)) {
      throw new UnauthorizedException('Người dùng không tồn tại');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Tài khoản đã bị khóa hoặc vô hiệu hóa');
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedTokenId },
      data: { revoked: true },
    });

    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET', 'change-me-access-secret'),
      expiresIn: asExpiresIn(
        this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      ),
    });

    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.config.get<string>(
          'JWT_REFRESH_SECRET',
          'change-me-refresh-secret',
        ),
        expiresIn: asExpiresIn(refreshExpiresIn),
      },
    );

    const tokenHash = await argon2.hash(refreshToken);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + parseDurationMs(refreshExpiresIn)),
      },
    });

    return { accessToken, refreshToken };
  }
}

function asExpiresIn(value: string): `${number}${'s' | 'm' | 'h' | 'd'}` {
  return value as `${number}${'s' | 'm' | 'h' | 'd'}`;
}

function parseDurationMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const value = Number(match[1]);
  const unitMs =
    { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 86_400_000;
  return value * unitMs;
}
