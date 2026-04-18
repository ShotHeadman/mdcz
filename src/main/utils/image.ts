import { open, stat } from "node:fs/promises";
import { join, parse } from "node:path";
import { isTrackType } from "mediainfo.js";
import { CHUNK_SIZE, runWithMediaInfo, toNumber } from "./video";

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageFileFormat = "jpeg" | "png" | "webp";
export type NormalizedImageFileExtension = ".jpg" | ".png" | ".webp";

export interface ImageValidation {
  valid: boolean;
  width: number;
  height: number;
  format?: ImageFileFormat;
  reason?: "file_too_small" | "parse_failed";
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const matchesSignature = (bytes: Uint8Array, signature: Uint8Array): boolean =>
  bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);

export const normalizeImageFileExtension = (extension: string): NormalizedImageFileExtension | null => {
  switch (extension.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return ".jpg";
    case ".png":
      return ".png";
    case ".webp":
      return ".webp";
    default:
      return null;
  }
};

export const getImageFileExtensionForFormat = (
  format: ImageFileFormat | undefined,
): NormalizedImageFileExtension | undefined => {
  switch (format) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    default:
      return undefined;
  }
};

export const replaceImageFileExtension = (filePath: string, extension: NormalizedImageFileExtension): string => {
  const parsedPath = parse(filePath);
  return join(parsedPath.dir, `${parsedPath.name}${extension}`);
};

export const buildImageFilePathVariants = (filePath: string): string[] => {
  const parsedPath = parse(filePath);
  const candidates = [filePath];

  for (const extension of [".jpg", ".jpeg", ".png", ".webp"]) {
    candidates.push(join(parsedPath.dir, `${parsedPath.name}${extension}`));
  }

  return Array.from(new Set(candidates));
};

export const detectImageFormat = (bytes: Uint8Array): ImageFileFormat | null => {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return "png";
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpeg";
  }

  if (bytes.length >= 16 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 12) === "WEBP") {
    return "webp";
  }

  return null;
};

const readUint16BE = (bytes: Uint8Array, offset: number): number => {
  return (bytes[offset] << 8) | bytes[offset + 1];
};

const readUint16LE = (bytes: Uint8Array, offset: number): number => {
  return bytes[offset] | (bytes[offset + 1] << 8);
};

const readUint24LE = (bytes: Uint8Array, offset: number): number => {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
};

const readUint32BE = (bytes: Uint8Array, offset: number): number => {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
};

const readAscii = (bytes: Uint8Array, start: number, end: number): string => {
  return String.fromCharCode(...bytes.subarray(start, end));
};

const toDimensions = (width: number, height: number): ImageDimensions | null => {
  return width > 0 && height > 0 ? { width, height } : null;
};

const parsePngDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (!matchesSignature(bytes, PNG_SIGNATURE) || bytes.length < 24) {
    return null;
  }

  if (readAscii(bytes, 12, 16) !== "IHDR") {
    return null;
  }

  return toDimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20));
};

const parseJpegDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset += 1;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    if (marker === undefined) {
      return null;
    }
    offset += 1;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) {
      return null;
    }

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      return toDimensions(readUint16BE(bytes, offset + 5), readUint16BE(bytes, offset + 3));
    }

    offset += segmentLength;
  }

  return null;
};

const parseWebpDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (bytes.length < 16 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 12) !== "WEBP") {
    return null;
  }

  const chunkType = readAscii(bytes, 12, 16);
  if (chunkType === "VP8X" && bytes.length >= 30) {
    return toDimensions(readUint24LE(bytes, 24) + 1, readUint24LE(bytes, 27) + 1);
  }

  if (chunkType === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return toDimensions(readUint16LE(bytes, 26) & 0x3fff, readUint16LE(bytes, 28) & 0x3fff);
  }

  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return toDimensions(width, height);
  }

  return null;
};

export function parseImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return parsePngDimensions(bytes) ?? parseJpegDimensions(bytes) ?? parseWebpDimensions(bytes);
}

export async function validateImage(filePath: string, minBytes = 8192): Promise<ImageValidation> {
  const fileStat = await stat(filePath);
  if (fileStat.size < minBytes) {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: "file_too_small",
    };
  }

  const handle = await open(filePath, "r");

  try {
    let format: ImageFileFormat | undefined;
    const headerLength = Math.min(CHUNK_SIZE, fileStat.size);
    if (headerLength > 0) {
      const header = Buffer.alloc(headerLength);
      const { bytesRead } = await handle.read(header, 0, headerLength, 0);
      const headerBytes = header.subarray(0, bytesRead);
      format = detectImageFormat(headerBytes) ?? undefined;
      const dimensions = parseImageDimensions(headerBytes);
      if (dimensions) {
        return {
          valid: true,
          width: dimensions.width,
          height: dimensions.height,
          format,
        };
      }
    }

    const metadata = await runWithMediaInfo((mediaInfo) =>
      mediaInfo.analyzeData(
        () => fileStat.size,
        async (chunkSize, offset) => {
          const remaining = Math.max(0, fileStat.size - offset);
          if (remaining === 0) {
            return new Uint8Array(0);
          }

          const requestedSize = chunkSize > 0 ? chunkSize : CHUNK_SIZE;
          const length = Math.min(requestedSize, remaining);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          return buffer.subarray(0, bytesRead);
        },
      ),
    );

    const tracks = metadata.media?.track ?? [];
    const track =
      tracks.find((item) => isTrackType(item, "Image")) ?? tracks.find((item) => isTrackType(item, "Video"));
    const width = Math.max(0, Math.round(toNumber(track?.Width)));
    const height = Math.max(0, Math.round(toNumber(track?.Height)));

    if (width <= 0 || height <= 0) {
      return {
        valid: false,
        width,
        height,
        reason: "parse_failed",
      };
    }

    return {
      valid: true,
      width,
      height,
      format,
    };
  } catch {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: "parse_failed",
    };
  } finally {
    await handle.close();
  }
}
