import { UserRole } from '@prisma/client';

// 3 role được phép đăng nhập/dùng CMS — khớp với role mà frontend-admin định nghĩa
// ở src/lib/roles.ts. CUSTOMER không bao giờ được coi là "admin" ở backend này.
export const ADMIN_PANEL_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.WAREHOUSE_STAFF,
  UserRole.MARKETING,
];

export function isAdminPanelRole(role: UserRole | undefined): boolean {
  return !!role && ADMIN_PANEL_ROLES.includes(role);
}
