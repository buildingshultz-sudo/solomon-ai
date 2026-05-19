import { ENV } from "./env";
import { getDb } from "../db";
import { settings } from "../../drizzle/schema";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

export const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

export const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider resolution.
//
// Solomon's Forge supports two LLM backends:
//   - "openai"  : the original OpenAI-compatible endpoint (cloud, paid)
//   - "ollama"  : a local Ollama server speaking its OpenAI-compat /v1 API
//                 (free, fully offline, runs on the user's PC)
//
// The active provider, base URL, model name and (optional) API key are read
// from the settings table at request time so the user can flip modes from the
// Settings page without restarting the server. Environment variables provide
// the boot defaults so the very first request also works.
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderConfig = {
  provider: "openai" | "ollama" | "openrouter";
  baseUrl: string;
  apiKey: string;
  model: string;
};

async function loadProviderConfig(): Promise<ProviderConfig> {
  // Boot defaults from env.
  const envProvider = (process.env.MODEL_PROVIDER || "openai").toLowerCase();
  const envOllamaBase = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const envOllamaModel = process.env.OLLAMA_MODEL || "llama3.1:8b";

  let provider: "openai" | "ollama" | "openrouter" =
    envProvider === "ollama" ? "ollama" : envProvider === "openrouter" ? "openrouter" : "openai";

  // For the openai provider, prefer standard OPENAI_BASE_URL env vars, then
  // fall back to the legacy BUILT_IN_FORGE_* vars so existing deployments keep working.
  const envOpenAiBase =
    ENV.openaiBaseUrl ||
    (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0 ? ENV.forgeApiUrl : "https://forge.manus.im");
  const envOpenAiKey = ENV.openaiApiKey || ENV.forgeApiKey || "";
  const envOpenAiModel = ENV.openaiModel || "gpt-4o-mini";

  let baseUrl =
    provider === "ollama"
      ? envOllamaBase
      : provider === "openrouter"
        ? "https://openrouter.ai/api"
        : envOpenAiBase;
  let apiKey =
    provider === "openrouter"
      ? (ENV.openrouterApiKey || "")
      : provider === "ollama"
        ? ""
        : envOpenAiKey;
  let model =
    provider === "ollama"
      ? envOllamaModel
      : provider === "openrouter"
        ? (ENV.openrouterModel || "anthropic/claude-3.5-sonnet")
        : envOpenAiModel;

  // Live overrides from settings (set by the Settings page).
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(settings);
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const provSetting = (map.get("provider.kind") || "").toLowerCase();
      if (provSetting === "ollama" || provSetting === "openai" || provSetting === "openrouter") {
        provider = provSetting;
      }
      if (provider === "ollama") {
        baseUrl = map.get("provider.ollama_base") || baseUrl;
        model = map.get("provider.ollama_model") || model;
      } else if (provider === "openrouter") {
        baseUrl = map.get("provider.openrouter_base") || baseUrl;
        model = map.get("provider.openrouter_model") || model;
        apiKey = map.get("apikey.openrouter") || apiKey;
      } else {
        baseUrl = map.get("provider.openai_base") || baseUrl;
        model = map.get("provider.openai_model") || model;
        apiKey = map.get("apikey.openai") || apiKey;
      }
    }
  } catch {
    // Settings table may not exist yet on first boot; fall through to env.
  }

  return { provider, baseUrl, apiKey, model };
}

export function buildChatUrl(cfg: ProviderConfig): string {
  // Ollama exposes /v1/chat/completions on its base URL (port 11434).
  // OpenAI uses the same path. Strip trailing slash and append.
  return `${cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

export const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const cfg = await loadProviderConfig();

  if (cfg.provider === "openai" && !cfg.apiKey) {
    throw new Error(
      "OpenAI provider selected but no API key configured. Either set apikey.openai in Settings or switch the provider to Ollama (free, local)."
    );
  }

  if (cfg.provider === "openrouter" && !cfg.apiKey) {
    throw new Error(
      "OpenRouter provider selected but no API key configured. Set apikey.openrouter in Settings → API Keys."
    );
  }

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  // Ollama and OpenRouter don't accept the proprietary `thinking` field.
  if (cfg.provider === "openai") {
    payload.max_tokens = 32768;
    payload.thinking = { budget_tokens: 128 };
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://solomonsforge.app";
    headers["X-Title"] = "Solomon's Forge";
  }

  const url = buildChatUrl(cfg);
  // Register this in-flight LLM call with the kill switch so the user can
  // abort it via the red "Task Master" button in the UI.
  const ac = new AbortController();
  const { registerOperation } = await import("../solomon/killSwitch");
  const killHandle = registerOperation({
    label: `LLM → ${cfg.provider}/${cfg.model}`,
    kind: "llm",
    controller: ac,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (err) {
    killHandle.complete();
    if ((err as any)?.name === "AbortError") {
      throw new Error("LLM call aborted by kill switch.");
    }
    if (cfg.provider === "ollama") {
      throw new Error(
        `Cannot reach local Ollama at ${cfg.baseUrl}. Make sure Ollama is running ` +
          `("ollama serve") and the model "${cfg.model}" is pulled ("ollama pull ${cfg.model}"). ` +
          `Underlying error: ${String(err)}`
      );
    }
    if (cfg.provider === "openrouter") {
      throw new Error(`Cannot reach OpenRouter at ${cfg.baseUrl}. Check your internet connection. Underlying error: ${String(err)}`);
    }
    throw err;
  }

  if (!response.ok) {
    killHandle.complete();
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed [${cfg.provider} → ${cfg.model}]: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  try {
    return (await response.json()) as InvokeResult;
  } finally {
    killHandle.complete();
  }
}
