import { Role } from '../types';

/**
 * Views only an admin can open. The backend enforces the matching routes
 * with require_admin; this is what keeps the menu honest, so a sales
 * executive is never shown a door that will not open.
 */
export const ADMIN_VIEWS = new Set<string>([
  'run',        // Discover - spends money
  'broadcast',  // Bulk Outreach - domain reputation on the line
  'templates',
  'mailboxes',
  'agents',
  'cost',
  'crm',
  // Settings is open to both roles: a rep changes their own password there.
  // The workspace tabs inside it are admin-only, and the backend requires an
  // admin for every write.
  'team',
]);

export function canView(role: Role, view: string): boolean {
  return role === 'admin' || !ADMIN_VIEWS.has(view);
}
