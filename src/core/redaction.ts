const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|authorization|auth|credential|session|cookie)/i;
const SECRET_VALUE_RE =
  /\b((?:sk|pk)-[A-Za-z0-9_\-]{12,}|(?:sk|pk)[A-Z0-9_\-]{12,}|(?:claude|codex|opencode)-[A-Za-z0-9_\-]{12,}|(?:claude|codex|opencode)[A-Z0-9_\-]{12,}|(?:ghp|github_pat|xox[baprs]|ya29)[A-Za-z0-9_\-]{12,}|Bearer\s+[A-Za-z0-9._\-]{12,})\b/g;
const SECRET_ASSIGNMENT_RE =
  /((?:"|')?[A-Za-z0-9_.-]*(?:token|secret|password|passwd|apikey|api_key|api-key|authorization|credential|session|cookie)[A-Za-z0-9_.-]*(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi;

export function redactValue(key: string, value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  return text.replace(SECRET_VALUE_RE, "[REDACTED]");
}

export function redactText(text: string): string {
  return text.replace(SECRET_ASSIGNMENT_RE, "$1[REDACTED]").replace(SECRET_VALUE_RE, "[REDACTED]");
}

export function redactEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = redactValue(key, value);
  }
  return out;
}
