const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|authorization|auth|credential|session|cookie)/i;
const SECRET_VALUE_RE =
  /\b((?:sk|pk)-[A-Za-z0-9_\-]{12,}|(?:sk|pk)[A-Z0-9_\-]{12,}|(?:claude|codex|opencode)-[A-Za-z0-9_\-]{12,}|(?:claude|codex|opencode)[A-Z0-9_\-]{12,}|(?:ghp|github_pat|xox[baprs]|ya29)[A-Za-z0-9_\-]{12,}|Bearer\s+[A-Za-z0-9._\-]{12,})\b/g;
const SECRET_ASSIGNMENT_RE =
  /((?:"|')?[A-Za-z0-9_.-]*(?:token|secret|password|passwd|apikey|api_key|api-key|authorization|credential|session|cookie)[A-Za-z0-9_.-]*(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;
const AUTH_TOKEN_ASSIGNMENT_RE =
  /(?:"|')?[A-Za-z0-9_.-]*AUTH_TOKEN[A-Za-z0-9_.-]*(?:"|')?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/g;
const PROMPT_ASSIGNMENT_RE = /(\b(?:prompt|systemPrompt|system_prompt)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\n\r,;}]+)/gi;
const ABSOLUTE_POSIX_PATH_RE = /(^|[\s=:("'[,])\/(?:[^\s"',;:{}[\]]+\/)+[^\s"',;:{}[\]]+/g;
const ABSOLUTE_WINDOWS_PATH_RE = /\b[A-Za-z]:\\(?:[^\s"',;:{}[\]]+\\)+[^\s"',;:{}[\]]+/g;
const PATH_KEY_RE = /^(cwd|path|file|home|workspace|storageDir|storage_dir)$/i;

export function redactValue(key: string, value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (key === "cwd") return "<cwd>";
  if (PATH_KEY_RE.test(key) && isAbsolutePathLike(text)) return "<path>";
  return redactText(text);
}

export function redactText(text: string): string {
  return text
    .replace(AUTH_TOKEN_ASSIGNMENT_RE, "[REDACTED]")
    .replace(PROMPT_ASSIGNMENT_RE, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT_RE, "$1[REDACTED]")
    .replace(SECRET_VALUE_RE, "[REDACTED]")
    .replace(ABSOLUTE_WINDOWS_PATH_RE, "<path>")
    .replace(ABSOLUTE_POSIX_PATH_RE, "$1<path>");
}

export function redactEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

export function redactUnknown<T>(value: T, key = ""): T {
  if (typeof value === "string") return redactValue(key, value) as T;
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, key)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactUnknown(childValue, childKey);
  }
  return out as T;
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\\/u.test(value);
}
