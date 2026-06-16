import type { AgentEventInput } from "../core/events.js";
import type { StreamParser } from "../adapters/adapter-types.js";

export class PlainLineParser implements StreamParser {
  parse(chunk: string): AgentEventInput[] {
    return chunk ? [{ type: "text_delta", text: chunk }] : [];
  }

  flush(): AgentEventInput[] {
    return [];
  }
}
