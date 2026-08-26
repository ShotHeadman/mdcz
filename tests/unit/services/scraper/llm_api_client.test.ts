import { LlmApiClient, type LlmTransportError } from "@mdcz/runtime/scrape";
import { DEFAULT_LLM_BASE_URL } from "@mdcz/shared/llm";
import { describe, expect, it, vi } from "vitest";

describe("LlmApiClient", () => {
  it("uses the responses endpoint first and omits authorization when api key is empty", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      resolvedUrl: "http://127.0.0.1:11434/v1/responses",
      headers: new Headers(),
      data: {
        output_text: "本地响应",
      },
    });

    const client = new LlmApiClient({ postJsonDetailed });

    await expect(
      client.generateText({
        model: "qwen3:8b",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
        temperature: 0.2,
        prompt: "hello",
      }),
    ).resolves.toBe("本地响应");

    expect(postJsonDetailed).toHaveBeenCalledTimes(1);
    expect(postJsonDetailed).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/responses",
      expect.objectContaining({
        model: "qwen3:8b",
        input: "hello",
      }),
      expect.objectContaining({
        headers: expect.any(Headers),
        signal: undefined,
      }),
    );

    const headers = postJsonDetailed.mock.calls[0][2].headers as Headers;
    expect(headers.has("authorization")).toBe(false);
  });

  it("extracts only visible output text from responses containing reasoning", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      resolvedUrl: "http://127.0.0.1:1234/v1/responses",
      headers: new Headers(),
      data: {
        output: [
          {
            type: "reasoning",
            content: [
              {
                type: "reasoning_text",
                text: "The user wants me to translate the Japanese sentence...",
              },
            ],
          },
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "那是某日黄昏时分的事。",
              },
            ],
          },
        ],
      },
    });

    const client = new LlmApiClient({ postJsonDetailed });

    await expect(
      client.generateText({
        model: "qwen3.8-27b",
        apiKey: "",
        baseUrl: "http://127.0.0.1:1234/v1",
        temperature: 0,
        prompt: "translate",
      }),
    ).resolves.toBe("那是某日黄昏时分的事。");
  });

  it("falls back to chat completions when responses is unsupported", async () => {
    const postJsonDetailed = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        resolvedUrl: `${DEFAULT_LLM_BASE_URL}/responses`,
        headers: new Headers(),
        data: {
          error: {
            message: "Responses API is not supported",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        resolvedUrl: `${DEFAULT_LLM_BASE_URL}/chat/completions`,
        headers: new Headers(),
        data: {
          choices: [
            {
              message: {
                content: "聊天回退成功",
              },
            },
          ],
        },
      });

    const client = new LlmApiClient({ postJsonDetailed });

    await expect(
      client.generateText({
        model: "gpt-5.2",
        apiKey: "test-key",
        baseUrl: "",
        temperature: 1,
        prompt: "hello",
      }),
    ).resolves.toBe("聊天回退成功");

    expect(postJsonDetailed).toHaveBeenCalledTimes(2);
    expect(postJsonDetailed.mock.calls[0][0]).toBe(`${DEFAULT_LLM_BASE_URL}/responses`);
    expect(postJsonDetailed.mock.calls[1][0]).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);

    const headers = postJsonDetailed.mock.calls[1][2].headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-key");
  });

  it("uses chat completions first for Google AI Studio OpenAI compatibility", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      resolvedUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      headers: new Headers(),
      data: {
        choices: [
          {
            message: {
              content: "聊天接口成功",
            },
          },
        ],
      },
    });

    const client = new LlmApiClient({ postJsonDetailed });
    const request = {
      model: "gemini-2.5-flash",
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      temperature: 1,
      prompt: "hello",
    };

    await expect(client.generateText(request)).resolves.toBe("聊天接口成功");
    await expect(client.generateText({ ...request, prompt: "again" })).resolves.toBe("聊天接口成功");

    expect(postJsonDetailed).toHaveBeenCalledTimes(2);
    expect(postJsonDetailed.mock.calls.map((call) => call[0])).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    ]);
    expect(postJsonDetailed.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    const headers = postJsonDetailed.mock.calls[0][2].headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-key");
  });

  it("throws a typed error when responses fails without a supported fallback", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      resolvedUrl: `${DEFAULT_LLM_BASE_URL}/responses`,
      headers: new Headers(),
      data: {
        error: {
          message: "Invalid API key",
        },
      },
    });

    const client = new LlmApiClient({ postJsonDetailed });

    await expect(
      client.generateText({
        model: "gpt-5.2",
        apiKey: "bad-key",
        baseUrl: "",
        temperature: 1,
        prompt: "hello",
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Invalid API key"),
    });
  });

  it("preserves transport failures as LlmTransportError with a cause", async () => {
    const cause = new Error("Error reading response stream: kind: Body");
    const client = new LlmApiClient({ postJsonDetailed: vi.fn().mockRejectedValue(cause) });

    await expect(
      client.generateText({
        model: "deepseek-chat",
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        temperature: 0,
        prompt: "translate",
      }),
    ).rejects.toMatchObject({
      name: "LlmTransportError",
      message: expect.stringContaining("LLM request failed for https://api.deepseek.com/responses"),
      cause,
    } satisfies Partial<LlmTransportError>);
  });

  it("throws a clear error when a successful response contains no text", async () => {
    const postJsonDetailed = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      resolvedUrl: `${DEFAULT_LLM_BASE_URL}/chat/completions`,
      headers: new Headers(),
      data: {
        choices: [
          {
            finish_reason: "stop",
            message: {},
          },
        ],
      },
    });

    const client = new LlmApiClient({ postJsonDetailed });

    await expect(
      client.generateText({
        model: "gpt-5.2",
        apiKey: "test-key",
        baseUrl: "",
        temperature: 1,
        prompt: "hello",
      }),
    ).rejects.toThrow("LLM response did not contain text");
  });
});
