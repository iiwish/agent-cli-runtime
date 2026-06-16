const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|authorization|auth|credential|session|cookie)/i;
const SECRET_VALUE_RE =
  /\b((?:sk|pk|ghp|github_pat|xox[baprs]|ya29|claude|codex|opencode)[A-Za-z0-9_\-]{12,}|Bearer\s+[A-Za-z0-9._\-]{12,})\b/g;

export function redactValue(key: string, value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  return text.replace(SECRET_VALUE_RE, "[REDACTED]");
}

export function redactText(text: string): string {
  return text.replace(SECRET_VALUE_RE, "[REDACTED]");
}

export function redactEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = redactValue(key, value);
  }
  return out;
}
