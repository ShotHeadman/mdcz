import { LlmApiClient, type LlmJsonSchema, type LlmTransportError } from "@mdcz/runtime/llm";
import {
  DEFAULT_LLM_BASE_URL,
  type LlmApiFormat,
  type LlmOutputFormat,
  type LlmReasoning,
  type LlmServiceType,
} from "@mdcz/shared/llm";
import { describe, expect, it, vi } from "vitest";

const response = (data: unknown, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Bad Request",
  resolvedUrl: "",
  headers: new Headers(),
  data,
});

const textRequest = (overrides: {
  baseUrl: string;
  apiFormat: LlmApiFormat;
  reasoning: LlmReasoning;
  serviceType?: LlmServiceType;
  outputFormat?: LlmOutputFormat;
  outputSchema?: LlmJsonSchema;
  temperature?: number;
  model?: string;
  apiKey?: string;
}) => ({
  model: overrides.model ?? "model",
  apiKey: overrides.apiKey ?? "",
  prompt: "hello",
  serviceType: overrides.serviceType ?? "openai-compatible",
  outputFormat: overrides.outputFormat ?? "none",
  ...overrides,
});

describe("LlmApiClient", () => {
  it.each([
    {
      name: "generic Responses defaults",
      request: { baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "responses" as const, reasoning: "default" as const },
      url: "http://127.0.0.1:11434/v1/responses",
      expected: { model: "model", input: "hello" },
      absent: ["temperature", "reasoning"],
      data: { output_text: "ok" },
    },
    {
      name: "generic Chat explicit effort",
      request: {
        baseUrl: "https://example.test/v1",
        apiFormat: "chat-completions" as const,
        reasoning: "high" as const,
      },
      url: "https://example.test/v1/chat/completions",
      expected: { model: "model", reasoning_effort: "high", messages: [{ role: "user", content: "hello" }] },
      absent: ["temperature", "response_format"],
      data: { choices: [{ message: { content: "ok" } }] },
    },
    {
      name: "explicit Google service type on a custom proxy",
      request: {
        baseUrl: "https://proxy.example/v1",
        apiFormat: "responses" as const,
        reasoning: "low" as const,
        serviceType: "google" as const,
      },
      url: "https://proxy.example/v1/chat/completions",
      expected: { reasoning_effort: "low" },
      absent: ["thinking", "response_format"],
      data: { choices: [{ message: { content: "ok" } }] },
    },
    {
      name: "explicit DeepSeek service type",
      request: {
        baseUrl: "https://llm-gateway.example/v1",
        apiFormat: "responses" as const,
        reasoning: "disabled" as const,
        serviceType: "deepseek" as const,
      },
      url: "https://llm-gateway.example/v1/chat/completions",
      expected: { thinking: { type: "disabled" } },
      absent: ["reasoning_effort", "response_format"],
      data: { choices: [{ message: { content: "ok" } }] },
    },
    ...(["default", "enabled", "low", "high", "max"] as const).map((reasoning) => ({
      name: `DeepSeek ${reasoning} thinking`,
      request: {
        baseUrl: "https://api.deepseek.com",
        apiFormat: "chat-completions" as const,
        serviceType: "deepseek" as const,
        reasoning,
      },
      url: "https://api.deepseek.com/chat/completions",
      expected:
        reasoning === "default"
          ? {}
          : {
              thinking: { type: "enabled" },
              ...(reasoning === "enabled" ? {} : { reasoning_effort: reasoning }),
            },
      absent: [
        "temperature",
        "response_format",
        ...(reasoning === "default"
          ? ["thinking", "reasoning_effort"]
          : reasoning === "enabled"
            ? ["reasoning_effort"]
            : []),
      ],
      data: { choices: [{ message: { content: "ok" } }] },
    })),
  ])("constructs $name requests from explicit service type", async ({ request, url, expected, absent, data }) => {
    const postJsonDetailed = vi.fn().mockResolvedValue(response(data));
    const client = new LlmApiClient({ postJsonDetailed });

    await expect(client.generateText(textRequest(request))).resolves.toBe("ok");
    const payload = postJsonDetailed.mock.calls[0][1] as Record<string, unknown>;
    expect(postJsonDetailed.mock.calls[0][0]).toBe(url);
    expect(payload).toEqual(expect.objectContaining(expected));
    for (const field of absent) expect(payload).not.toHaveProperty(field);
  });

  it("sends configured output formats independently of the request shape", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue(response({ choices: [{ message: { content: "ok" } }] }));
    const client = new LlmApiClient({ postJsonDetailed });

    await client.generateText(
      textRequest({
        baseUrl: "https://example.test/v1",
        apiFormat: "chat-completions",
        reasoning: "default",
        outputFormat: "json_object",
      }),
    );
    expect(postJsonDetailed.mock.calls[0][1]).toEqual(
      expect.objectContaining({ response_format: { type: "json_object" } }),
    );

    postJsonDetailed.mockResolvedValue(response({ output_text: "ok" }));
    await client.generateText(
      textRequest({
        baseUrl: "https://example.test/v1",
        apiFormat: "responses",
        reasoning: "default",
        outputFormat: "json_schema",
        outputSchema: {
          name: "translation",
          schema: {
            type: "object",
            properties: { translation: { type: "string" } },
            required: ["translation"],
            additionalProperties: false,
          },
        },
      }),
    );
    expect(postJsonDetailed.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        text: {
          format: {
            type: "json_schema",
            name: "translation",
            schema: {
              type: "object",
              properties: { translation: { type: "string" } },
              required: ["translation"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      }),
    );
  });

  it("sends explicit temperature and encodes disabled Responses reasoning as none", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue(response({ output_text: "ok" }));
    const client = new LlmApiClient({ postJsonDetailed });
    await client.generateText(
      textRequest({
        model: "gpt-test",
        apiKey: "key",
        baseUrl: "",
        apiFormat: "responses",
        temperature: 0,
        reasoning: "disabled",
      }),
    );
    expect(postJsonDetailed.mock.calls[0][1]).toEqual(
      expect.objectContaining({ temperature: 0, reasoning: { effort: "none" } }),
    );
  });

  it("does not downgrade a rejected Responses request", async () => {
    const postJsonDetailed = vi
      .fn()
      .mockResolvedValue(response({ error: { message: "unsupported parameter" } }, false));
    const client = new LlmApiClient({ postJsonDetailed });
    await expect(
      client.generateText(
        textRequest({
          model: "gpt-test",
          apiKey: "key",
          baseUrl: DEFAULT_LLM_BASE_URL,
          apiFormat: "responses",
          reasoning: "default",
        }),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("unsupported parameter") });
    expect(postJsonDetailed).toHaveBeenCalledTimes(1);
  });

  it("preserves transport failures with their cause", async () => {
    const cause = new Error("body timed out");
    const client = new LlmApiClient({ postJsonDetailed: vi.fn().mockRejectedValue(cause) });
    await expect(
      client.generateText(
        textRequest({
          model: "deepseek-chat",
          apiKey: "key",
          baseUrl: "https://api.deepseek.com",
          apiFormat: "chat-completions",
          reasoning: "default",
          serviceType: "deepseek",
        }),
      ),
    ).rejects.toMatchObject({ name: "LlmTransportError", cause } satisfies Partial<LlmTransportError>);
  });
});
