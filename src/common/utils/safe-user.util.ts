import { User } from '@prisma/client';

// Không bao giờ trả field `password` ra response (xem CLAUDE.md, mục Auth & phân quyền).
export function toSafeUser(user: User): Omit<User, 'password'> {
  const safeUser: Partial<User> = { ...user };
  delete safeUser.password;
  return safeUser as Omit<User, 'password'>;
}
