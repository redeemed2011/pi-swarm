// Saved agents live in ~/.dpi/agents.json (or $DPI_AGENTS_FILE). Each autostart
// entry calls spawnSession once per key, so a restart finds the same session
// and admits the first prompt only once.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { THINKING_LEVELS, type ThinkingLevel } from "../../dpi-sdk/src/api.js";
import { GROK_PROVIDER } from "./grok.js";
import type { Store } from "./store.js";

export interface SavedAgent {
  key: string;
  name: string;
  cwd: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  prompt?: string;
  autostart: boolean;
}

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function agentsFile(env: NodeJS.ProcessEnv = process.env) {
  if (env.DPI_AGENTS_FILE) return env.DPI_AGENTS_FILE;
  return join(env.DPI_HOME ?? join(homedir(), ".dpi"), "agents.json");
}

export function loadSavedAgents(file: string): SavedAgent[] {
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw Error(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { agents?: unknown }).agents)
    ? (raw as { agents: unknown[] }).agents
    : undefined;
  if (!list) throw Error(`${file} must be a list of agents, or { "agents": [...] }`);
  const keys = new Set<string>();
  return list.map((item, index) => {
    const agent = parseAgent(item, `${file}[${index}]`);
    if (keys.has(agent.key)) throw Error(`${file}: duplicate key ${agent.key}`);
    keys.add(agent.key);
    return agent;
  });
}

function parseAgent(item: unknown, where: string): SavedAgent {
  if (!item || typeof item !== "object") throw Error(`${where} must be an object`);
  const agent = item as Record<string, unknown>;
  if (typeof agent.key !== "string" || !KEY.test(agent.key)) throw Error(`${where}.key must match ${KEY}`);
  if (typeof agent.name !== "string" || !agent.name.trim()) throw Error(`${where}.name is required`);
  if (typeof agent.cwd !== "string" || !agent.cwd.trim()) throw Error(`${where}.cwd is required`);
  if (agent.model !== undefined && typeof agent.model !== "string") throw Error(`${where}.model must be a string`);
  if (agent.prompt !== undefined && typeof agent.prompt !== "string") throw Error(`${where}.prompt must be a string`);
  if (agent.thinkingLevel !== undefined && !(THINKING_LEVELS as readonly string[]).includes(String(agent.thinkingLevel)))
    throw Error(`${where}.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`);
  return {
    key: agent.key,
    name: agent.name.trim(),
    cwd: agent.cwd.trim(),
    ...(typeof agent.model === "string" ? { model: agent.model } : {}),
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel as ThinkingLevel } : {}),
    ...(typeof agent.prompt === "string" ? { prompt: agent.prompt } : {}),
    autostart: agent.autostart === true,
  };
}

/** Start every autostart profile. A bad profile is logged and skipped. */
export async function startSavedAgents(store: Store, file: string) {
  const started = [];
  for (const agent of loadSavedAgents(file).filter((item) => item.autostart)) {
    try {
      const model = store.routedModel(agent.model ? { provider: GROK_PROVIDER, modelId: agent.model } : undefined);
      started.push(
        await store.spawnSession({
          key: agent.key,
          name: agent.name,
          cwd: agent.cwd,
          model,
          thinkingLevel: agent.thinkingLevel,
          prompt: agent.prompt,
        }),
      );
    } catch (e) {
      console.error(`[saved-agents] ${agent.key}:`, e instanceof Error ? e.message : e);
    }
  }
  return started;
}
