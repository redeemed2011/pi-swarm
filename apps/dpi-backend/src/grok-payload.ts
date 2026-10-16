// cli-chat-proxy.grok.com rejects a stock OpenAI Responses body. This is the
// subset of pi-grok-cli's sanitizer that text and tool turns need.
import { grokModel } from "./model-catalog.js";

const ENCRYPTED_REASONING = "reasoning.encrypted_content";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      const type = typeof item.type === "string" ? item.type : "";
      return ["text", "input_text", "output_text"].includes(type) && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeReasoningContent(content: unknown) {
  if (typeof content === "string") return content ? [{ type: "reasoning_text", text: content }] : undefined;
  if (!Array.isArray(content)) return undefined;
  const normalized = content.flatMap((part) => {
    if (typeof part === "string") return part ? [{ type: "reasoning_text", text: part }] : [];
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const item = part as Record<string, unknown>;
    if (item.type === "reasoning_text" && typeof item.text === "string") return [part];
    if (item.type !== undefined || typeof item.text !== "string") return [];
    return [{ ...item, type: "reasoning_text" }];
  });
  return normalized.length ? normalized : undefined;
}

/** Mutates the Responses payload so the Grok CLI proxy accepts it. */
export function sanitizeGrokPayload(payload: unknown, modelId: string, sessionId?: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const next = payload as Record<string, unknown>;
  const spec = grokModel(modelId);
  const reasoningSupported = spec?.reasoning ?? true;
  const effortSupported = spec?.effort ?? false;

  if (Array.isArray(next.input)) {
    let input = next.input
      .map((item) => {
        if (!item || typeof item !== "object") return item;
        const obj = item as Record<string, unknown>;
        if (obj.type === "reasoning") {
          delete obj.status;
          const content = normalizeReasoningContent(obj.content);
          if (content) obj.content = content;
          else delete obj.content;
        }
        if (typeof obj.content === "string" && obj.content.length === 0) return null;
        return obj;
      })
      .filter((item): item is Record<string, unknown> => item !== null);

    const instructionParts: string[] = [];
    input = input.filter((item) => {
      if (item.role !== "developer" && item.role !== "system") return true;
      const text = textFromContent(item.content).trim();
      if (text) instructionParts.push(text);
      return false;
    });
    if (instructionParts.length) {
      const existing = typeof next.instructions === "string" ? next.instructions : "";
      next.instructions = [existing, ...instructionParts].filter(Boolean).join("\n\n");
    }
    next.input = input;
  }

  if (next.response_format) {
    if (!next.text) next.text = { format: next.response_format };
    delete next.response_format;
  }

  delete next.reasoningEffort;
  const reasoning =
    next.reasoning && typeof next.reasoning === "object" && !Array.isArray(next.reasoning)
      ? { ...(next.reasoning as Record<string, unknown>) }
      : undefined;
  if (!reasoningSupported || !reasoning) delete next.reasoning;
  else {
    if (effortSupported && reasoning.effort === "minimal") reasoning.effort = "low";
    if (!effortSupported || reasoning.effort === undefined) delete reasoning.effort;
    if (Object.keys(reasoning).length === 0) delete next.reasoning;
    else next.reasoning = reasoning;
  }

  if (Array.isArray(next.include)) {
    let keptEncrypted = false;
    const include = next.include.filter((item) => {
      if (item !== ENCRYPTED_REASONING) return true;
      if (!reasoningSupported || keptEncrypted) return false;
      keptEncrypted = true;
      return true;
    });
    if (next.reasoning !== undefined && !keptEncrypted) include.push(ENCRYPTED_REASONING);
    next.include = include.length ? include : undefined;
    if (!next.include) delete next.include;
  } else if (next.reasoning !== undefined) {
    next.include = [ENCRYPTED_REASONING];
  }

  delete next.prompt_cache_retention;
  if (sessionId && !next.prompt_cache_key) next.prompt_cache_key = sessionId;
  return next;
}
