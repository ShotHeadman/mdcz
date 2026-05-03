export type DetailViewStatus = "success" | "failed" | "processing";

export interface DetailViewItem {
  id: string;
  status: DetailViewStatus;
  number: string;
  minimalErrorView?: boolean;
  title?: string;
  path?: string;
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
  errorMessage?: string;
}
