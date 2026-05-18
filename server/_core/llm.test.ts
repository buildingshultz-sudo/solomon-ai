import { describe, expect, it } from "vitest";
import {
  buildChatUrl,
  normalizeMessage,
  normalizeResponseFormat,
  normalizeToolChoice,
} from "./llm";
import type { Message, ProviderConfig, Tool } from "./llm";

const cfg = (provider: "openai" | "ollama", baseUrl: string): ProviderConfig => ({
  provider,
  baseUrl,
  apiKey: "key",
  model: "gpt-4o",
});

describe("buildChatUrl", () => {
  it("appends /v1/chat/completions to openai base URL", () => {
    expect(buildChatUrl(cfg("openai", "https://api.openai.com"))).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  it("strips trailing slash before appending path", () => {
    expect(buildChatUrl(cfg("ollama", "http://127.0.0.1:11434/"))).toBe(
      "http://127.0.0.1:11434/v1/chat/completions"
    );
  });

  it("works for Ollama base URL without trailing slash", () => {
    expect(buildChatUrl(cfg("ollama", "http://localhost:11434"))).toBe(
      "http://localhost:11434/v1/chat/completions"
    );
  });
});

describe("normalizeMessage", () => {
  it("collapses single text content to a plain string", () => {
    const msg: Message = { role: "user", content: "hello" };
    const result = normalizeMessage(msg);
    expect(result.content).toBe("hello");
  });

  it("converts TextContent object to a plain string when alone", () => {
    const msg: Message = { role: "user", content: { type: "text", text: "world" } };
    const result = normalizeMessage(msg);
    expect(result.content).toBe("world");
  });

  it("preserves array content with multiple parts", () => {
    const msg: Message = {
      role: "user",
      content: [
        { type: "text", text: "here is an image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    };
    const result = normalizeMessage(msg);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("serializes tool role content to a string", () => {
    const msg: Message = {
      role: "tool",
      content: [{ type: "text", text: "result" }],
      tool_call_id: "call_123",
    };
    const result = normalizeMessage(msg);
    expect(typeof result.content).toBe("string");
    expect(result.tool_call_id).toBe("call_123");
  });

  it("JSON-stringifies non-string tool content parts", () => {
    const msg: Message = {
      role: "tool",
      content: [{ type: "text", text: "a" }],
      tool_call_id: "x",
    };
    const result = normalizeMessage(msg);
    expect(result.content).toBe(JSON.stringify({ type: "text", text: "a" }));
  });
});

describe("normalizeToolChoice", () => {
  const tool = (name: string): Tool => ({
    type: "function",
    function: { name },
  });

  it("passes through 'none' and 'auto' unchanged", () => {
    expect(normalizeToolChoice("none", undefined)).toBe("none");
    expect(normalizeToolChoice("auto", [])).toBe("auto");
  });

  it("returns undefined when toolChoice is undefined", () => {
    expect(normalizeToolChoice(undefined, undefined)).toBeUndefined();
  });

  it("expands 'required' to explicit function choice when exactly one tool", () => {
    const result = normalizeToolChoice("required", [tool("my_tool")]);
    expect(result).toEqual({ type: "function", function: { name: "my_tool" } });
  });

  it("throws when 'required' is used with no tools", () => {
    expect(() => normalizeToolChoice("required", [])).toThrow();
  });

  it("throws when 'required' is used with multiple tools", () => {
    expect(() => normalizeToolChoice("required", [tool("a"), tool("b")])).toThrow();
  });

  it("expands {name} shorthand to explicit function choice", () => {
    const result = normalizeToolChoice({ name: "search" }, [tool("search")]);
    expect(result).toEqual({ type: "function", function: { name: "search" } });
  });

  it("passes through already-explicit ToolChoiceExplicit unchanged", () => {
    const explicit = { type: "function" as const, function: { name: "do_thing" } };
    expect(normalizeToolChoice(explicit, [tool("do_thing")])).toEqual(explicit);
  });
});

describe("normalizeResponseFormat", () => {
  it("returns undefined when nothing is provided", () => {
    expect(normalizeResponseFormat({})).toBeUndefined();
  });

  it("passes through { type: 'text' } unchanged", () => {
    const result = normalizeResponseFormat({ responseFormat: { type: "text" } });
    expect(result).toEqual({ type: "text" });
  });

  it("passes through { type: 'json_object' } unchanged", () => {
    const result = normalizeResponseFormat({ response_format: { type: "json_object" } });
    expect(result).toEqual({ type: "json_object" });
  });

  it("throws when json_schema format has no schema", () => {
    expect(() =>
      normalizeResponseFormat({
        responseFormat: { type: "json_schema", json_schema: { name: "x", schema: undefined as any } },
      })
    ).toThrow();
  });

  it("converts outputSchema to json_schema response format", () => {
    const result = normalizeResponseFormat({
      outputSchema: { name: "my_schema", schema: { type: "object" }, strict: true },
    });
    expect(result).toEqual({
      type: "json_schema",
      json_schema: { name: "my_schema", schema: { type: "object" }, strict: true },
    });
  });

  it("throws when outputSchema is missing name or schema", () => {
    expect(() =>
      normalizeResponseFormat({ outputSchema: { name: "", schema: { type: "object" } } })
    ).toThrow();
    expect(() =>
      normalizeResponseFormat({ outputSchema: { name: "x", schema: undefined as any } })
    ).toThrow();
  });

  it("prefers explicit responseFormat over outputSchema", () => {
    const result = normalizeResponseFormat({
      responseFormat: { type: "json_object" },
      outputSchema: { name: "x", schema: { type: "object" } },
    });
    expect(result?.type).toBe("json_object");
  });
});
