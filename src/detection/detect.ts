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
    return unavailable(adapter, [
      diagnostic("AGENT_UNAVAILABLE", `${adapter.displayName} executable was not found`, {
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
      diagnostic("AGENT_NOT_EXECUTABLE", `${adapter.displayName} could not be invoked`, {
        agentId: adapter.id,
        path: resolution.selectedPath,
        stderrTail: redactText(error instanceof Error ? error.message : String(error)),
      }),
    ]);
  }

  const models = await probeModels(adapter, resolution.selectedPath, env);
  const authStatus = await probeAuth(adapter, resolution.selectedPath, env);
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    available: true,
    path: resolution.selectedPath,
    version,
    authStatus,
    models: models.models,
    modelsSource: models.source,
    capabilities: {
      streaming: adapter.capabilities?.streaming ?? true,
      tools: adapter.capabilities?.tools ?? false,
      models: adapter.capabilities?.models ?? Boolean(adapter.listModels),
      authProbe: Boolean(adapter.authProbe),
      prompt: [adapter.promptTransport.kind],
    },
    diagnostics: [],
  };
}

async function probeModels(
  adapter: AgentAdapterDef,
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<{ models: RuntimeModelOption[]; source: "live" | "fallback" | "none" }> {
  if (!adapter.listModels) {
    return { models: adapter.fallbackModels ?? [], source: adapter.fallbackModels?.length ? "fallback" : "none" };
  }
  try {
    const probe = await execProbe(command, adapter.listModels.args, { env, timeoutMs: adapter.listModels.timeoutMs ?? 5_000 });
    const parsed = adapter.listModels.parse(probe.stdout, probe.stderr);
    if (parsed?.length) return { models: parsed, source: "live" };
  } catch {
    // Fallback model hints are part of the public detection contract.
  }
  return { models: adapter.fallbackModels ?? [], source: adapter.fallbackModels?.length ? "fallback" : "none" };
}

async function probeAuth(
  adapter: AgentAdapterDef,
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<DetectedAgent["authStatus"]> {
  if (!adapter.authProbe) return "unknown";
  try {
    const probe = await execProbe(command, adapter.authProbe.args, { env, timeoutMs: adapter.authProbe.timeoutMs ?? 3_000 });
    return adapter.authProbe.parse?.(probe.stdout, probe.stderr) ?? "unknown";
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
    if (stdout || stderr) return adapter.authProbe.parse?.(stdout, stderr) ?? "unknown";
    return "unknown";
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
