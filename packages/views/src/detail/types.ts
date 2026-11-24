import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";

export type DetailViewStatus = "success" | "failed" | "processing";

export interface ImageCandidateVariant {
  width: number;
  format?: "avif" | "source" | "webp";
}

export const DETAIL_IMAGE_VARIANTS = {
  poster: { width: 400, format: "webp" },
  thumb: { width: 960, format: "webp" },
  scene: { width: 480, format: "webp" },
  compactScene: { width: 160, format: "webp" },
  diffImage: { width: 640, format: "webp" },
} as const satisfies Record<string, ImageCandidateVariant>;

export interface DetailViewItem {
  resultId?: string;
  artworkRevision?: string;
  id: string;
  status: DetailViewStatus;
  number: string;
  minimalErrorView?: boolean;
  title?: string;
  path?: string;
  fileRef?: RootFileRef;
  nfoRef?: RootFileRef;
  assets?: AssetRef[];
  nfoPath?: string;
  actors?: string[];
  plot?: string;
  genres?: string[];
  releaseDate?: string;
  durationSeconds?: number;
  resolution?: string;
  bitrate?: number;
  director?: string;
  series?: string;
  studio?: string;
  publisher?: string;
  rating?: number;
  posterUrl?: string;
  thumbUrl?: string;
  fanartUrl?: string;
  outputPath?: string;
  sceneImages?: string[];
  trailerUrl?: string;
  trailerFallbackUrls?: string[];
  errorMessage?: string;
}
