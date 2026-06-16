import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AgentAdapterDef } from "../adapters/adapter-types.js";
import { pathDirs } from "./env.js";

export interface ExecutableResolutionOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  searchPath?: string[];
}

export interface ExecutableResolution {
  configuredOverridePath: string | null;
  pathResolvedPath: string | null;
  selectedPath: string | null;
  searchedLocations: string[];
}

export function resolveExecutable(adapter: AgentAdapterDef, options: ExecutableResolutionOptions = {}): ExecutableResolution {
  const env = options.env ?? process.env;
  const configuredOverridePath = adapter.binEnvVar ? executablePath(env[adapter.binEnvVar]) : null;
  const candidates = [adapter.bin, ...(adapter.fallbackBins ?? [])];
  const searchedLocations: string[] = [];
  let pathResolvedPath: string | null = null;
  for (const dir of pathDirs(env, options.searchPath)) {
    for (const candidate of candidates) {
      for (const ext of executableExtensions()) {
        const full = path.join(dir, `${candidate}${ext}`);
        searchedLocations.push(full);
        if (!pathResolvedPath && executablePath(full)) pathResolvedPath = full;
      }
    }
  }
  return {
    configuredOverridePath,
    pathResolvedPath,
    selectedPath: configuredOverridePath ?? pathResolvedPath,
    searchedLocations,
  };
}

function executablePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const candidate = raw.trim();
  if (!path.isAbsolute(candidate)) return null;
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
    if (process.platform === "win32") return candidate;
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function executableExtensions(): string[] {
  if (process.platform !== "win32") return [""];
  return (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => ext.toLowerCase());
}
