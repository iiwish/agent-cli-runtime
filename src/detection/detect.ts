import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AgentAdapterDef, DetectedAgent, RuntimeModelOption } from "../adapters/adapter-types.js";
import type { RuntimeDiagnostic } from "../core/diagnostics.js";
import { diagnostic } from "../core/diagnostics.js";
import { redactText } from "../core/redaction.js";
import { resolveExecutable } from "./executable-resolution.js";
import { execProbe } from "./invocation.js";
import { mergeEnv } from "./env.js";

export interface DetectOptions {
  envByAgent?: Record<string, Record<string, string>>;
  includeUnavailable?: boolean;
  timeoutMs?: number;
}

export interface DetectionContext {
  adapters: AgentAdapterDef[];
  env?: NodeJS.ProcessEnv;
  searchPath?: string[];
}

export async function detectAgents(context: DetectionContext, options: DetectOptions = {}): Promise<DetectedAgent[]> {
  const agents = await Promise.all(context.adapters.map((adapter) => safeDetectAdapter(adapter, context, options)));
  return options.includeUnavailable ? agents : agents.filter((agent) => agent.available);
}

export async function* detectAgentsStream(context: DetectionContext, options: DetectOptions = {}): AsyncIterable<DetectedAgent> {
  const probes = context.adapters.map((adapter, index) =>
    safeDetectAdapter(adapter, context, options).then((agent) => ({ index, agent })),
  );
  const pending = new Set(probes.keys());
  while (pending.size > 0) {
    const { index, agent } = await Promise.race(probes.filter((_, probeIndex) => pending.has(probeIndex)));
    pending.delete(index);
    if (options.includeUnavailable || agent.available) yield agent;
  }
}

async function safeDetectAdapter(adapter: AgentAdapterDef, context: DetectionContext, options: DetectOptions): Promise<DetectedAgent> {
  try {
    return await detectAdapter(adapter, context, options);
  } catch (error) {
    return unavailable(adapter, [
      diagnostic("AGENT_UNAVAILABLE", `Detection failed for ${adapter.id}`, {
        agentId: adapter.id,
        stderrTail: redactText(error instanceof Error ? error.message : String(error)),
      }),
    ]);
  }
}

async function detectAdapter(adapter: AgentAdapterDef, context: DetectionContext, options: DetectOptions): Promise<DetectedAgent> {
  const configuredEnv = options.envByAgent?.[adapter.id] ?? {};
  const env = mergeEnv(context.env ?? process.env, adapter.env, configuredEnv);
  const resolution = resolveExecutable(adapter, { env, searchPath: context.searchPath });
  if (!resolution.selectedPath) {
    const notExecutablePath = notExecutableCandidatePath(adapter, env, resolution.searchedLocations);
    if (notExecutablePath) {
      return unavailable(adapter, [
        diagnostic("not_executable", `${adapter.displayName} executable is not executable`, {
          agentId: adapter.id,
          path: notExecutablePath,
          searchedLocations: resolution.searchedLocations,
        }),
      ]);
    }
    return unavailable(adapter, [
      diagnostic("not_installed", `${adapter.displayName} executable was not found`, {
        agentId: adapter.id,
        searchedLocations: resolution.searchedLocations,
      }),
    ]);
  }

  let version: string | null = null;
  try {
    const probe = await execProbe(resolution.selectedPath, adapter.versionArgs, {
      env,
      timeoutMs: options.timeoutMs ?? 3_000,
    });
    version = probe.stdout.trim().split(/\r?\n/u)[0] || null;
  } catch (error) {
    return unavailable(adapter, [
      probeDiagnostic("version", error, `${adapter.displayName} could not be invoked`, {
        agentId: adapter.id,
        path: resolution.selectedPath,
      }),
    ]);
  }

  const capabilityDiagnostics = await probeCapabilities(adapter, resolution.selectedPath, env);
  const models = await probeModels(adapter, resolution.selectedPath, env);
  const authStatus = await probeAuth(adapter, resolution.selectedPath, env);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    available: true,
    path: resolution.selectedPath,
    version,
    authStatus: authStatus.status,
    models: models.models,
    modelsSource: models.source,
    capabilities: {
      streaming: adapter.capabilities?.streaming ?? true,
      tools: adapter.capabilities?.tools ?? false,
      models: adapter.capabilities?.models ?? Boolean(adapter.listModels),
      authProbe: Boolean(adapter.authProbe),
      prompt: [adapter.promptTransport.kind],
    },
    diagnostics: [...capabilityDiagnostics, ...models.diagnostics, ...authStatus.diagnostics],
  };
}

async function probeCapabilities(adapter: AgentAdapterDef, command: string, env: NodeJS.ProcessEnv): Promise<RuntimeDiagnostic[]> {
  if (!adapter.helpArgs && !adapter.capabilityFlags) return [];
  if (!adapter.helpArgs) {
    return [
      diagnostic("probe_failed", `${adapter.displayName} declares capability flags without a help probe`, {
        agentId: adapter.id,
        path: command,
        probe: "capabilities",
        retryable: false,
      }),
    ];
  }
  try {
    const probe = await execProbe(command, adapter.helpArgs, { env, timeoutMs: 3_000 });
    const output = `${probe.stdout}\n${probe.stderr}`;
    return Object.keys(adapter.capabilityFlags ?? {})
      .filter((flag) => !output.includes(flag))
      .map((flag) =>
        diagnostic("unsupported_flag", `${adapter.displayName} capability flag is not present in help output: ${flag}`, {
          agentId: adapter.id,
          path: command,
          probe: "capabilities",
          stdoutTail: probe.stdout ? redactText(tail(probe.stdout)) : undefined,
          stderrTail: probe.stderr ? redactText(tail(probe.stderr)) : undefined,
          retryable: false,
        }),
      );
  } catch (error) {
    return [probeDiagnostic("capabilities", error, `${adapter.displayName} capability probe failed`, { agentId: adapter.id, path: command })];
  }
}

async function probeModels(
  adapter: AgentAdapterDef,
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<{ models: RuntimeModelOption[]; source: "live" | "fallback" | "none"; diagnostics: RuntimeDiagnostic[] }> {
  if (!adapter.listModels) {
    return { models: adapter.fallbackModels ?? [], source: adapter.fallbackModels?.length ? "fallback" : "none", diagnostics: [] };
  }
  const diagnostics: RuntimeDiagnostic[] = [];
  try {
    const probe = await execProbe(command, adapter.listModels.args, { env, timeoutMs: adapter.listModels.timeoutMs ?? 5_000 });
    const parsed = adapter.listModels.parse(probe.stdout, probe.stderr);
    if (parsed?.length) return { models: parsed, source: "live", diagnostics };
    diagnostics.push(probeDiagnostic("models", { stdout: probe.stdout, stderr: probe.stderr }, `${adapter.displayName} model probe produced no supported model lines`, { agentId: adapter.id, path: command }));
  } catch (error) {
    diagnostics.push(probeDiagnostic("models", error, `${adapter.displayName} model probe failed`, { agentId: adapter.id, path: command }));
    // Fallback model hints are part of the public detection contract.
  }
  return { models: adapter.fallbackModels ?? [], source: adapter.fallbackModels?.length ? "fallback" : "none", diagnostics };
}

async function probeAuth(
  adapter: AgentAdapterDef,
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<{ status: DetectedAgent["authStatus"]; diagnostics: RuntimeDiagnostic[] }> {
  if (!adapter.authProbe) return { status: "unknown", diagnostics: [] };
  try {
    const probe = await execProbe(command, adapter.authProbe.args, { env, timeoutMs: adapter.authProbe.timeoutMs ?? 3_000 });
    const status = adapter.authProbe.parse?.(probe.stdout, probe.stderr) ?? "unknown";
    return {
      status,
      diagnostics: status === "missing" || status === "expired" ? [probeDiagnostic("auth", { stdout: probe.stdout, stderr: probe.stderr, authStatus: status }, `${adapter.displayName} auth is ${status}`, { agentId: adapter.id, path: command })] : [],
    };
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
    const parsed = stdout || stderr ? adapter.authProbe.parse?.(stdout, stderr) : undefined;
    const status = parsed === "missing" || parsed === "expired" ? parsed : isAuthMissingText(`${stdout}\n${stderr}`) ? "missing" : "unknown";
    const diagnosticInput = error && typeof error === "object" ? { ...(error as Record<string, unknown>), authStatus: status } : { authStatus: status, stderr: String(error) };
    return {
      status,
      diagnostics: [probeDiagnostic("auth", diagnosticInput, status === "missing" ? `${adapter.displayName} auth is missing` : `${adapter.displayName} auth probe failed`, { agentId: adapter.id, path: command })],
    };
  }
}

function probeDiagnostic(
  probe: "version" | "models" | "auth" | "capabilities",
  error: unknown,
  fallbackMessage: string,
  init: Omit<RuntimeDiagnostic, "code" | "message" | "probe" | "stdoutTail" | "stderrTail"> = {},
): RuntimeDiagnostic {
  const stdout = stringField(error, "stdout");
  const stderr = stringField(error, "stderr");
  const text = `${stdout}\n${stderr}\n${error instanceof Error ? error.message : String(error)}`;
  const code = classifyProbeError(probe, error, text);
  return diagnostic(code, redactText(messageForProbe(code, fallbackMessage)), {
    ...init,
    probe,
    exitCode: numberField(error, "code"),
    signal: stringField(error, "signal"),
    stdoutTail: stdout ? redactText(tail(stdout)) : undefined,
    stderrTail: stderr ? redactText(tail(stderr)) : redactText(errorMessage(error)),
    retryable: code === "network_error" || code === "probe_failed",
  });
}

function classifyProbeError(probe: "version" | "models" | "auth" | "capabilities", error: unknown, text: string): string {
  const errCode = stringField(error, "code");
  if (errCode === "ENOENT") return "not_installed";
  if (errCode === "EACCES" || errCode === "EPERM") return "not_executable";
  if (probe === "auth" && (isAuthMissingText(text) || stringField(error, "authStatus") === "missing")) return "auth_missing";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|fetch failed|socket hang up/i.test(text)) return "network_error";
  if (/unknown (option|flag)|unrecognized (option|flag)|unsupported (option|flag)|invalid (option|flag)|unknown argument/i.test(text)) return "unsupported_flag";
  return "probe_failed";
}

function messageForProbe(code: string, fallback: string): string {
  if (code === "auth_missing") return "Auth is missing or expired for this CLI";
  if (code === "network_error") return "Probe failed because of a network error";
  if (code === "unsupported_flag") return "Probe failed because the installed CLI does not support the requested flag or command";
  if (code === "not_installed") return "CLI executable was not found";
  if (code === "not_executable") return "CLI executable is not executable";
  return fallback;
}

function isAuthMissingText(text: string): boolean {
  return /auth(entication)? required|not authenticated|not logged in|login required|please log in|unauthorized|invalid api key/i.test(text);
}

function stringField(value: unknown, key: string): string {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof raw === "string" ? raw : "";
}

function numberField(value: unknown, key: string): number | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof raw === "number" ? raw : null;
}

function tail(value: string, max = 4_000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = stringField(error, "message");
  if (message) return message;
  return typeof error === "string" ? error : "";
}

function notExecutableCandidatePath(adapter: AgentAdapterDef, env: NodeJS.ProcessEnv, searchedLocations: string[]): string | null {
  const configured = configuredNotExecutablePath(adapter, env);
  if (configured) return configured;
  return searchedLocations.find((candidate) => isNotExecutableFile(candidate)) ?? null;
}

function configuredNotExecutablePath(adapter: AgentAdapterDef, env: NodeJS.ProcessEnv): string | null {
  if (!adapter.binEnvVar) return null;
  const raw = env[adapter.binEnvVar];
  if (typeof raw !== "string" || !path.isAbsolute(raw)) return null;
  return isNotExecutableFile(raw) ? raw : null;
}

function isNotExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    if (process.platform === "win32") return false;
    accessSync(candidate, constants.X_OK);
    return false;
  } catch {
    return true;
  }
}

function unavailable(adapter: AgentAdapterDef, diagnostics: RuntimeDiagnostic[] = []): DetectedAgent {
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    available: false,
    models: adapter.fallbackModels ?? [],
    modelsSource: adapter.fallbackModels?.length ? "fallback" : "none",
    capabilities: {
      streaming: adapter.capabilities?.streaming ?? true,
      tools: adapter.capabilities?.tools ?? false,
      models: adapter.capabilities?.models ?? Boolean(adapter.listModels),
      authProbe: Boolean(adapter.authProbe),
      prompt: [adapter.promptTransport.kind],
    },
    diagnostics,
  };
}
