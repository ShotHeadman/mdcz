import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { RuntimeNetworkClient } from "../../../network";
import { throwIfAborted } from "../../utils/abort";
import type { MachineTranslator } from "../types";

const responseSchema = z.object({
  error_code: z.union([z.string(), z.number()]).optional(),
  error_msg: z.string().optional(),
  trans_result: z.array(z.object({ src: z.string(), dst: z.string().trim().min(1) })).optional(),
});

export class BaiduTranslator {
  constructor(private readonly networkClient: RuntimeNetworkClient) {
    networkClient.setDomainLimit?.("fanyi-api.baidu.com", 1, 1);
  }

  readonly translate: MachineTranslator = async (texts, target, config, signal) => {
    if (!texts.length) return [];
    const appid = config.translate.baiduAppId.trim();
    const secret = config.translate.baiduSecretKey.trim();
    if (!appid || !secret) throw new Error("Baidu translation requires an app ID and secret key");
    const lines = texts.map((text) =>
      text
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const chunks: string[] = [];
          let chunk = "";
          let bytes = 0;
          for (const character of line) {
            const characterBytes = Buffer.byteLength(character, "utf8");
            if (bytes + characterBytes > 6000) {
              chunks.push(chunk);
              chunk = "";
              bytes = 0;
            }
            chunk += character;
            bytes += characterBytes;
          }
          if (chunk) chunks.push(chunk);
          return chunks;
        }),
    );
    const segments = lines.flat(2);
    const translated: string[] = [];
    for (let offset = 0; offset < segments.length; ) {
      const batch: string[] = [];
      let bytes = 0;
      while (offset < segments.length) {
        const line = segments[offset];
        const separatorLength = batch.length ? 1 : 0;
        const lineBytes = Buffer.byteLength(line, "utf8") + separatorLength;
        if (batch.length && bytes + lineBytes > 6000) break;
        batch.push(line);
        bytes += lineBytes;
        offset += 1;
      }
      const q = batch.join("\n");
      const salt = randomUUID();
      const sign = createHash("md5")
        .update(appid + q + salt + secret)
        .digest("hex");
      const body = new URLSearchParams({ q, from: "auto", to: target === "zh_tw" ? "cht" : "zh", appid, salt, sign });
      throwIfAborted(signal);
      const response = await this.networkClient.postText(
        "https://fanyi-api.baidu.com/api/trans/vip/translate",
        body.toString(),
        { signal, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      const payload = responseSchema.parse(JSON.parse(response));
      if (payload.error_code !== undefined && String(payload.error_code) !== "52000") {
        throw new Error(`Baidu translate error ${payload.error_code}: ${payload.error_msg ?? "Unknown error"}`);
      }
      if (payload.trans_result?.length !== batch.length) throw new Error("Baidu translation result count mismatch");
      translated.push(...payload.trans_result.map((result) => result.dst));
    }
    let offset = 0;
    return lines.map((lines) => {
      const result = lines
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
