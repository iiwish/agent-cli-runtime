import type { AgentEventInput } from "../core/events.js";
import { ClaudeStreamJsonParser } from "../parsers/claude-stream-json.js";
import { CodexJsonParser } from "../parsers/codex-json.js";
import { OpenCodeJsonParser } from "../parsers/opencode-json.js";
import type { StreamParser } from "../adapters/adapter-types.js";

export interface ParserFixtureCase {
  agentId: "codex" | "claude" | "opencode";
  name: string;
  chunks: string[];
  expectedTypes: AgentEventInput["type"][];
}

export interface ParserFixtureResult {
  agentId: string;
  name: string;
  ok: boolean;
  eventTypes: string[];
  expectedTypes: string[];
  eventCount: number;
}

export const parserFixtureCases: ParserFixtureCase[] = [
  {
    agentId: "codex",
    name: "normal output",
    chunks: ['{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'],
    expectedTypes: ["status", "text_delta"],
  },
  {
    agentId: "codex",
    name: "structured error",
    chunks: ['{"type":"error","message":"boom"}\n'],
    expectedTypes: ["error"],
  },
  {
    agentId: "codex",
    name: "usage",
    chunks: ['{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"reasoning_tokens":3}}\n'],
    expectedTypes: ["usage"],
  },
  {
    agentId: "codex",
    name: "tool and file event",
    chunks: [
      '{"type":"exec_command.begin","call_id":"cmd_1","command":"pwd"}\n',
      '{"type":"exec_command.end","call_id":"cmd_1","stdout":"/tmp","exit_code":0}\n',
      '{"type":"item.completed","item":{"type":"file_event","path":"README.md","action":"updated"}}\n',
    ],
    expectedTypes: ["tool_call", "tool_result", "file_event"],
  },
  {
    agentId: "codex",
    name: "partial line",
    chunks: ['{"type":"item.completed","item":{"type":"agent_message","text":"hel', 'lo"}}\n'],
    expectedTypes: ["text_delta"],
  },
  {
    agentId: "codex",
    name: "unknown event",
    chunks: ['{"type":"new.future.event","payload":true}\n'],
    expectedTypes: [],
  },
  {
    agentId: "claude",
    name: "normal output",
    chunks: ['{"type":"system"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n'],
    expectedTypes: ["status", "text_delta"],
  },
  {
    agentId: "claude",
    name: "structured error",
    chunks: ['{"type":"error","error":{"message":"auth required"}}\n'],
    expectedTypes: ["error"],
  },
  {
    agentId: "claude",
    name: "usage",
    chunks: ['{"type":"result","usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3}}\n'],
    expectedTypes: ["usage"],
  },
  {
    agentId: "claude",
    name: "tool and file event",
    chunks: [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"README.md"}},{"type":"tool_result","tool_use_id":"tool_1","content":"ok"},{"type":"file_event","path":"README.md","action":"updated"}]}}\n',
    ],
    expectedTypes: ["tool_call", "tool_result", "file_event"],
  },
  {
    agentId: "claude",
    name: "partial line",
    chunks: ['{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hel', 'lo"}}}\n'],
    expectedTypes: ["text_delta"],
  },
  {
    agentId: "claude",
    name: "unknown event",
    chunks: ['{"type":"future","event":{"type":"new"}}\n'],
    expectedTypes: [],
  },
  {
    agentId: "opencode",
    name: "normal output",
    chunks: ['{"type":"step_start"}\n{"type":"text","part":{"text":"ok"}}\n'],
    expectedTypes: ["status", "text_delta"],
  },
  {
    agentId: "opencode",
    name: "structured error",
    chunks: ['{"type":"error","error":"bad request"}\n'],
    expectedTypes: ["error"],
  },
  {
    agentId: "opencode",
    name: "usage",
    chunks: ['{"type":"step_finish","part":{"tokens":{"input":1,"output":2,"reasoning":3},"cost":0.01}}\n'],
    expectedTypes: ["usage"],
  },
  {
    agentId: "opencode",
    name: "tool and file event",
    chunks: [
      '{"type":"tool_use","part":{"callID":"call_1","tool":"bash","state":{"input":"{\\"cmd\\":\\"pwd\\"}","status":"completed","output":"ok"}}}\n',
      '{"type":"file","part":{"path":"README.md","action":"updated"}}\n',
    ],
    expectedTypes: ["tool_call", "tool_result", "file_event"],
  },
  {
    agentId: "opencode",
    name: "partial line",
    chunks: ['{"type":"text","part":{"text":"hel', 'lo"}}\n'],
    expectedTypes: ["text_delta"],
  },
  {
    agentId: "opencode",
    name: "unknown event",
    chunks: ['{"type":"future","part":{}}\n'],
    expectedTypes: [],
  },
];

export function runParserFixtureCases(agentId?: string): ParserFixtureResult[] {
  return parserFixtureCases
    .filter((fixture) => !agentId || agentId === "all" || fixture.agentId === agentId)
    .map((fixture) => {
      const parser = createParser(fixture.agentId);
      const events = fixture.chunks.flatMap((chunk) => parser.parse(chunk)).concat(parser.flush());
      const eventTypes = events.map((event) => event.type);
      return {
        agentId: fixture.agentId,
        name: fixture.name,
        ok: arraysEqual(eventTypes, fixture.expectedTypes),
        eventTypes,
        expectedTypes: fixture.expectedTypes,
        eventCount: events.length,
      };
    });
}

function createParser(agentId: ParserFixtureCase["agentId"]): StreamParser {
  if (agentId === "codex") return new CodexJsonParser();
  if (agentId === "claude") return new ClaudeStreamJsonParser();
  return new OpenCodeJsonParser();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
