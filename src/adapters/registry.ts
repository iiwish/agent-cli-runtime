import type { AgentAdapterDef, AgentId } from "./adapter-types.js";
import { codexAdapter } from "./codex.js";
import { claudeAdapter } from "./claude.js";
import { opencodeAdapter } from "./opencode.js";

export class AdapterRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapterDef>();

  constructor(adapters: AgentAdapterDef[] = defaultAdapters()) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: AgentAdapterDef): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentId): AgentAdapterDef | null {
    return this.adapters.get(id) ?? null;
  }

  list(): AgentAdapterDef[] {
    return Array.from(this.adapters.values());
  }
}

export function defaultAdapters(): AgentAdapterDef[] {
  return [codexAdapter, claudeAdapter, opencodeAdapter];
}
