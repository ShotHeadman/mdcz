import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { RuntimeNetworkClient } from "../../../network";
import { throwIfAborted } from "../../utils/abort";
import type { MachineTranslator } from "../types";

// General translation caps q at 6,000 bytes; for CJK text that is the ~2,000 characters Baidu recommends for LLM requests.
const MAX_REQUEST_BYTES = 6000;

const responseSchema = z.object({
  error_code: z.union([z.string(), z.number()]).optional(),
  error_msg: z.string().optional(),
  trans_result: z.array(z.object({ dst: z.string() })).optional(),
});

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

const splitChunks = (line: string): string[] => {
  const chunks = [""];
  let bytes = 0;
  // Iterating code points keeps multi-byte characters and surrogate pairs intact across chunk boundaries.
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > MAX_REQUEST_BYTES) {
      chunks.push("");
      bytes = 0;
    }
    chunks[chunks.length - 1] += character;
    bytes += characterBytes;
  }
  return chunks;
};

export class BaiduTranslator {
  constructor(private readonly networkClient: RuntimeNetworkClient) {
    // Standard accounts allow 1 QPS and Baidu rejects back-to-back requests that land 1s apart (54003), so leave a margin.
    networkClient.setDomainInterval?.("fanyi-api.baidu.com", 1100);
  }

  readonly translate: MachineTranslator = async (texts, target, config, signal) => {
    if (!texts.length) return [];
    const { baiduService, baiduAppId, baiduSecretKey, baiduApiKey } = config.translate;
    const appid = baiduAppId.trim();
    const credential = (baiduService === "llm" ? baiduApiKey : baiduSecretKey).trim();
    if (!appid || !credential) {
      throw new Error(`Baidu translation requires an APPID and ${baiduService === "llm" ? "API key" : "secret key"}`);
    }
    const to = target === "zh_tw" ? "cht" : "zh";
    const lines = texts.map((text) => splitLines(text).map(splitChunks));
    const segments = lines.flat(2);
    const translated: string[] = [];
    for (let offset = 0; offset < segments.length; ) {
      const batch = [segments[offset]];
      let bytes = Buffer.byteLength(segments[offset], "utf8");
      for (offset += 1; offset < segments.length; offset += 1) {
        bytes += Buffer.byteLength(segments[offset], "utf8") + 1;
        if (bytes > MAX_REQUEST_BYTES) break;
        batch.push(segments[offset]);
      }
      const q = batch.join("\n");
      throwIfAborted(signal);
      const salt = randomUUID();
      const response =
        baiduService === "llm"
          ? await this.networkClient.postJson(
              "https://fanyi-api.baidu.com/ait/api/aiTextTranslate",
              { appid, q, from: "auto", to },
              { signal, headers: { Authorization: `Bearer ${credential}` } },
            )
          : JSON.parse(
              await this.networkClient.postText(
                "https://fanyi-api.baidu.com/api/trans/vip/translate",
                new URLSearchParams({
                  q,
                  from: "auto",
                  to,
                  appid,
                  salt,
                  sign: createHash("md5")
                    .update(appid + q + salt + credential)
                    .digest("hex"),
                }).toString(),
                { signal, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
              ),
            );
      const payload = responseSchema.parse(response);
      if (payload.error_code !== undefined && String(payload.error_code) !== "52000") {
        throw new Error(`Baidu translate error ${payload.error_code}: ${payload.error_msg ?? "Unknown error"}`);
      }
      // General translation answers per line; the LLM may also return one multi-line result. Both flatten alike.
      const results = (payload.trans_result ?? []).flatMap((result) => splitLines(result.dst));
      if (results.length !== batch.length) throw new Error("Baidu translation result count mismatch");
      translated.push(...results);
    }
    let offset = 0;
    return lines.map((textLines) => {
      const result = textLines
        .map((chunks) => {
          const line = translated.slice(offset, offset + chunks.length).join("");
          offset += chunks.length;
          return line;
        })
        .join("\n");
      return result || null;
    });
  };
}
