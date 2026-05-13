import type { IncomingMessage } from 'node:http';
import { isAuthEnabled, verifyToken } from './jwt';
import type { AppDatabase, UserRecord } from '../storage/database';

export interface AuthContext {
  user: UserRecord;
  token: { sub: string; username: string };
}

export type Role = 'owner' | 'editor' | 'viewer';

export function extractAuth(request: IncomingMessage, db: AppDatabase): AuthContext | null {
  if (!isAuthEnabled()) return null;

  const header = request.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = db.getUserById(payload.sub);
  if (!user) return null;

  return { user, token: { sub: payload.sub, username: payload.username } };
}

export function requireRole(
  db: AppDatabase,
  projectId: string,
  userId: string,
  minRole: Role,
): boolean {
  if (!isAuthEnabled()) return true;

  const role = db.getProjectRole(projectId, userId);
  if (!role) return false;

  const ranks: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 };
  return ranks[role] >= ranks[minRole];
}
