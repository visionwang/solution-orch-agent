const API_KEY_PATTERN = /(api[_-]?key|token|secret|password)\s*=\s*[^\s]+/gi;
const BEARER_PATTERN = /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SK_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}\b/g;
const USER_PATH_PATTERN = /\/Users\/[^\s'"`]+/g;

export function redactSensitiveText(input: string): string {
  return input
    .replace(API_KEY_PATTERN, '$1=[REDACTED]')
    .replace(BEARER_PATTERN, 'Authorization: Bearer [REDACTED]')
    .replace(SK_PATTERN, '[REDACTED]')
    .replace(USER_PATH_PATTERN, '[REDACTED_PATH]');
}

export function safeJson<T>(value: T): T {
  return JSON.parse(redactSensitiveText(JSON.stringify(value))) as T;
}

