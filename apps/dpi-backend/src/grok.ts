// Grok CLI provider for pi-ai. Tokens come from the Pi grok-cli account vault
// (~/.pi/grok-cli/accounts.json) or from GROK_CLI_OAUTH_TOKEN.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider } from "@earendil-works/pi-ai/models";
import type { ApiKeyAuth, Model, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { grokModels } from "./model-catalog.js";
import { sanitizeGrokPayload } from "./grok-payload.js";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
const VERSION_FALLBACK = "1.0.46";
const REFRESH_SKEW_MS = 60_000;

export const GROK_PROVIDER = "grok-cli";
export const GROK_BASE = (process.env.PI_GROK_CLI_BASE_URL || process.env.GROK_CLI_BASE_URL || "https://cli-chat-proxy.grok.com/v1").replace(
  /\/+$/,
  "",
);

let grokVersion = VERSION_FALLBACK;

function vaultPath() {
  return join(process.env.HOME || homedir(), ".pi", "grok-cli", "accounts.json");
}

interface Credential {
  access: string;
  refresh: string;
  expires: number;
  tokenEndpoint?: string;
  discovery?: { token_endpoint?: string };
  [key: string]: unknown;
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const cred = value as Record<string, unknown>;
  return (
    typeof cred.access === "string" &&
    cred.access.length > 0 &&
    cred.access !== "pi-grok-cli-account-vault-v1" &&
    typeof cred.refresh === "string" &&
    cred.refresh.length > 0 &&
    typeof cred.expires === "number"
  );
}

function readVault(): { raw: Record<string, unknown>; accountId: string; credential: Credential } | undefined {
  const path = vaultPath();
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const active = typeof raw.activeAccountId === "string" ? raw.activeAccountId : undefined;
  const ordered = [
    ...accounts.filter((account) => account && typeof account === "object" && (account as { id?: string }).id === active),
    ...accounts,
  ];
  for (const account of ordered) {
    if (!account || typeof account !== "object") continue;
    const record = account as { id?: string; credential?: unknown };
    if (typeof record.id === "string" && isCredential(record.credential)) {
      return { raw, accountId: record.id, credential: record.credential };
    }
  }
  return undefined;
}

function writeCredential(raw: Record<string, unknown>, accountId: string, credential: Credential) {
  const accounts = raw.accounts;
  if (!Array.isArray(accounts)) return;
  for (const account of accounts) {
    if (account && typeof account === "object" && (account as { id?: string }).id === accountId) {
      (account as { credential: Credential }).credential = credential;
    }
  }
  const path = vaultPath();
  const next = `${path}.tmp`;
  writeFileSync(next, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, path);
  chmodSync(path, 0o600);
}

async function refresh(credential: Credential): Promise<Credential> {
  const endpoint = credential.tokenEndpoint || credential.discovery?.token_endpoint || TOKEN_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: credential.refresh,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error(`Grok CLI token refresh failed: HTTP ${response.status}. Sign in again with Pi.`);
  const payload = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!payload.access_token) throw Error("Grok CLI token refresh did not return an access token. Sign in again with Pi.");
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    ...credential,
    access: payload.access_token,
    refresh: payload.refresh_token || credential.refresh,
    expires: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
    tokenEndpoint: endpoint,
  };
}

let inflight: Promise<string | undefined> | undefined;

/** A bearer token for cli-chat-proxy. Refreshes the Pi vault when the access token is due. */
export function grokAccessToken(): Promise<string | undefined> {
  if (!inflight) inflight = loadToken().finally(() => { inflight = undefined; });
  return inflight;
}

async function loadToken(): Promise<string | undefined> {
  const fromEnv = process.env.GROK_CLI_OAUTH_TOKEN;
  if (fromEnv) return fromEnv;
  const vault = readVault();
  if (!vault) return undefined;
  if (vault.credential.expires > Date.now() + REFRESH_SKEW_MS) return vault.credential.access;
  const next = await refresh(vault.credential);
  writeCredential(vault.raw, vault.accountId, next);
  return next.access;
}

function grokAuth(): ApiKeyAuth {
  return {
    name: "Grok CLI",
    async check() {
      if (process.env.GROK_CLI_OAUTH_TOKEN) return { source: "GROK_CLI_OAUTH_TOKEN", type: "api_key" };
      return readVault() ? { source: "Pi Grok CLI login", type: "api_key" } : undefined;
    },
    async resolve() {
      const key = await grokAccessToken();
      if (!key) return undefined;
      return {
        auth: { apiKey: key },
        source: process.env.GROK_CLI_OAUTH_TOKEN ? "GROK_CLI_OAUTH_TOKEN" : "Pi Grok CLI login",
      };
    },
  };
}

function modelHeaders(modelId: string): Record<string, string> {
  return {
    "x-grok-client-identifier": "grok-shell",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-model-override": modelId,
  };
}

function versionHeaders(): Record<string, string> {
  return {
    "User-Agent": `grok-shell/${grokVersion} (linux; x64)`,
    "x-grok-client-version": grokVersion,
  };
}

/** Looks up the Grok CLI release once. A missing lookup keeps the fallback version. */
export function startGrokVersionLookup() {
  const url = process.env.PI_GROK_CLI_VERSION_URL || "https://x.ai/cli/stable";
  void fetch(url, { signal: AbortSignal.timeout(5_000) })
    .then(async (response) => (response.ok ? (await response.text()).trim() : ""))
    .then((version) => {
      if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) grokVersion = version;
    })
    .catch(() => {});
}

export function grokCliProvider() {
  startGrokVersionLookup();
  const api = openAIResponsesApi();
  const models: Model<"openai-responses">[] = grokModels.map((model) => ({
    id: model.id,
    name: model.name,
    api: "openai-responses",
    provider: GROK_PROVIDER,
    baseUrl: GROK_BASE,
    reasoning: model.reasoning,
    input: ["text", "image"],
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    headers: modelHeaders(model.id),
  }));
  const wrap = <T extends StreamOptions | SimpleStreamOptions>(options: T | undefined): T =>
    ({
      ...options,
      headers: { ...versionHeaders(), ...options?.headers },
      onPayload: (payload: unknown, model: Model<"openai-responses">) => {
        const sanitized = sanitizeGrokPayload(payload, model.id, options?.sessionId);
        if (!options?.onPayload) return sanitized;
        const next = options.onPayload(sanitized, model);
        if (next instanceof Promise) return next.then((value) => (value === undefined ? sanitized : value));
        return next === undefined ? sanitized : next;
      },
    }) as T;

  return createProvider<"openai-responses">({
    id: GROK_PROVIDER,
    name: "Grok CLI",
    baseUrl: GROK_BASE,
    auth: { apiKey: grokAuth() },
    models,
    api: {
      "openai-responses": {
        stream: (model, context, options) => api.stream(model, context, wrap(options)),
        streamSimple: (model, context, options) => api.streamSimple(model, context, wrap(options)),
      },
    },
  });
}
