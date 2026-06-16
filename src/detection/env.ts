import { delimiter } from "node:path";

export function pathDirs(env: NodeJS.ProcessEnv, extraSearchPath: string[] = []): string[] {
  const seen = new Set<string>();
  const dirs = [...extraSearchPath, ...(env.PATH ?? "").split(delimiter)].filter(Boolean);
  return dirs.filter((dir) => {
    if (seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

export function mergeEnv(...envs: Array<NodeJS.ProcessEnv | Record<string, string | undefined> | undefined>): NodeJS.ProcessEnv {
  return Object.assign({}, ...envs.filter(Boolean));
}
