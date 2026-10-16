// Models served by the Grok CLI proxy (cli-chat-proxy.grok.com). Auth is the
// Pi grok-cli login, not an API key in this repo.
export interface GrokModel {
  id: string;
  name: string;
  tier: string;
  icon: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Models that do not take reasoning.effort. */
  effort: boolean;
  thinkingLevelMap?: Record<string, string | null>;
}

export const grokModels: GrokModel[] = [
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    tier: "Grok",
    icon: "grok.png",
    reasoning: true,
    effort: true,
    contextWindow: 500_000,
    maxTokens: 30_000,
    cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
    thinkingLevelMap: { xhigh: "xhigh" },
  },
  {
    id: "grok-4.7-build-fast",
    name: "Grok 4.7 Fast",
    tier: "Grok",
    icon: "grok.png",
    reasoning: true,
    effort: true,
    contextWindow: 500_000,
    maxTokens: 30_000,
    cost: { input: 4, output: 12, cacheRead: 1, cacheWrite: 0 },
    thinkingLevelMap: { xhigh: "xhigh" },
  },
  {
    id: "grok-build",
    name: "Grok Build",
    tier: "Grok",
    icon: "grok.png",
    reasoning: true,
    effort: true,
    contextWindow: 500_000,
    maxTokens: 30_000,
    cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0.2 },
  },
];

export const defaultModelId = "grok-4.7";

export const grokModel = (id: string) => grokModels.find((model) => model.id === id);
