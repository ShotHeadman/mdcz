import { open } from "node:fs/promises";
import { extname, join } from "node:path";
import type { VideoMeta } from "@shared/types";
import { app } from "electron";
import { isTrackType, type MediaInfoResult, mediaInfoFactory } from "mediainfo.js";

const CHUNK_SIZE = 64 * 1024;

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toPositiveNumber = (value: unknown): number | undefined => {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : undefined;
};

const toVideoMetadata = (result: MediaInfoResult): VideoMeta => {
  const tracks = result.media?.track ?? [];
  const generalTrack = tracks.find((track) => isTrackType(track, "General"));
  const videoTrack = tracks.find((track) => isTrackType(track, "Video"));

  const codec =
    toOptionalString(videoTrack?.Format) ??
    toOptionalString(videoTrack?.CodecID_String) ??
    toOptionalString(videoTrack?.CodecID);

  const bitrate = toPositiveNumber(videoTrack?.BitRate) ?? toPositiveNumber(generalTrack?.OverallBitRate);

  return {
    durationSeconds: toNumber(generalTrack?.Duration),
    width: Math.max(0, Math.round(toNumber(videoTrack?.Width))),
    height: Math.max(0, Math.round(toNumber(videoTrack?.Height))),
    codec,
    bitrate,
  };
};

const initMediaInfo = () => {
  const locateFile = app.isPackaged ? (path: string) => join(process.resourcesPath, path) : undefined;
  return mediaInfoFactory({
    format: "object",
    chunkSize: CHUNK_SIZE,
    ...(locateFile ? { locateFile } : {}),
  });
};

let cachedPromise: ReturnType<typeof initMediaInfo> | undefined;

const getMediaInfo = () => {
  if (!cachedPromise) {
    cachedPromise = initMediaInfo();
  }
  return cachedPromise;
};

const isStreamFile = (filePath: string): boolean => extname(filePath).toLowerCase() === ".strm";

export const probeVideoMetadata = async (filePath: string): Promise<VideoMeta | undefined> => {
  if (isStreamFile(filePath)) {
    return undefined;
  }

  const mediaInfo = await getMediaInfo();
  const handle = await open(filePath, "r");

  try {
    const { size } = await handle.stat();
    const metadata = await mediaInfo.analyzeData(
      () => size,
      async (chunkSize, offset) => {
        const remaining = Math.max(0, size - offset);
        if (remaining === 0) {
          return new Uint8Array(0);
        }

        const requestedSize = chunkSize > 0 ? chunkSize : CHUNK_SIZE;
        const length = Math.min(requestedSize, remaining);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      },
    );

    return toVideoMetadata(metadata);
  } finally {
    await handle.close();
  }
};
