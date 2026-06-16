import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PromptTransport } from "../adapters/adapter-types.js";
import type { RunRequest } from "./run-types.js";

export interface PreparedPrompt {
  prompt: string;
  promptFilePath?: string;
  stdinData?: string;
  cleanup(): Promise<void>;
}

export function composePrompt(request: Pick<RunRequest, "systemPrompt" | "contextBlocks" | "prompt">): string {
  const chunks: string[] = [];
  if (request.systemPrompt?.trim()) chunks.push(request.systemPrompt.trim());
  for (const block of request.contextBlocks ?? []) {
    chunks.push(`## ${block.title}\n\n${block.body}`);
  }
  chunks.push(request.prompt);
  return chunks.join("\n\n");
}

export async function preparePromptTransport(transport: PromptTransport, prompt: string): Promise<PreparedPrompt> {
  if (transport.kind === "stdin") {
    return {
      prompt,
      stdinData: transport.inputFormat === "jsonl" ? `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n` : prompt,
      cleanup: async () => {},
    };
  }
  if (transport.kind === "file") {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-prompt-"));
    const promptFilePath = path.join(dir, "prompt.txt");
    await writeFile(promptFilePath, prompt, "utf8");
    return {
      prompt,
      promptFilePath,
      cleanup: async () => {
        const { rm } = await import("node:fs/promises");
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (bytes > transport.maxBytes) {
    const error = new Error(`Prompt is ${bytes} bytes; argv transport limit is ${transport.maxBytes}`);
    error.name = "AGENT_PROMPT_TOO_LARGE";
    throw error;
  }
  return { prompt, cleanup: async () => {} };
}
