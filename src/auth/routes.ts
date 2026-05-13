import type { IncomingMessage, ServerResponse } from 'node:http';
import { hash, verify } from 'node:crypto';
import type { AppDatabase } from '../storage/database';
import { isAuthEnabled, signToken } from './jwt';

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

async function hashPassword(password: string): Promise<string> {
  // Use SHA-256 with a salt for simplicity (no bcrypt dep)
  const salt = process.env.JWT_SECRET ?? 'default-salt';
  return new Promise((resolve, reject) => {
    const h = hash('sha256', `${salt}:${password}`);
    resolve(h);
  });
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashPassword(password);
  return inputHash === storedHash;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

interface LoginBody { username?: string; password?: string; }
interface RegisterBody { username?: string; password?: string; displayName?: string; }

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function createAuthRoutes(db: AppDatabase): { login: RouteHandler; register: RouteHandler } {
  return {
    async login(request, response) {
      if (!isAuthEnabled()) {
        return sendJson(response, 503, { error: 'auth disabled' });
      }

      const raw = await readBody(request);
      let body: LoginBody = {};
      try { body = JSON.parse(raw); } catch { return sendJson(response, 400, { error: 'invalid json' }); }

      const { username, password } = body;
      if (!username || !password) {
        return sendJson(response, 400, { error: 'username and password required' });
      }

      const user = db.getUserByUsername(username);
      if (!user) {
        return sendJson(response, 401, { error: 'invalid credentials' });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return sendJson(response, 401, { error: 'invalid credentials' });
      }

      const token = signToken({ sub: user.id, username: user.username });
      sendJson(response, 200, {
        token,
        user: { id: user.id, username: user.username, displayName: user.displayName },
      });
    },

    async register(request, response) {
      if (!isAuthEnabled()) {
        return sendJson(response, 503, { error: 'auth disabled' });
      }

      const raw = await readBody(request);
      let body: RegisterBody = {};
      try { body = JSON.parse(raw); } catch { return sendJson(response, 400, { error: 'invalid json' }); }

      const { username, password, displayName } = body;
      if (!username || !password) {
        return sendJson(response, 400, { error: 'username and password required' });
      }
      if (password.length < 8) {
        return sendJson(response, 400, { error: 'password must be at least 8 characters' });
      }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return sendJson(response, 400, { error: 'password must contain both letters and numbers' });
      }

      const existing = db.getUserByUsername(username);
      if (existing) {
        return sendJson(response, 409, { error: 'username already exists' });
      }

      const passwordHash = await hashPassword(password);
      const user = db.createUser(username, passwordHash, displayName ?? username);
      const token = signToken({ sub: user.id, username: user.username });

      sendJson(response, 201, {
        token,
        user: { id: user.id, username: user.username, displayName: user.displayName },
      });
    },
  };
}
