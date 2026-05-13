import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

const TOKEN_EXPIRY_MS = parseInt(process.env.JWT_EXPIRY ?? '86400000', 10);

function getSecret(): string | null {
  return process.env.JWT_SECRET ?? null;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function isAuthEnabled(): boolean {
  return !!getSecret();
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const secret = getSecret()!;
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + Math.floor(TOKEN_EXPIRY_MS / 1000) };

  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(full));
  const signature = sign(`${header}.${body}`, secret);

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): JwtPayload | null {
  const secret = getSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const expectedSig = sign(`${headerB64}.${bodyB64}`, secret);

  if (!timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) return null;

  try {
    const payload = JSON.parse(base64urlDecode(bodyB64)) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
