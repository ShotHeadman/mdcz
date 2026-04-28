import { randomUUID } from "node:crypto";
import path from "node:path";

export type MediaRootType = "mounted-filesystem";

export interface MediaRoot {
  id: string;
  displayName: string;
  hostPath: string;
  rootType: MediaRootType;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMediaRootInput {
  id?: string;
  displayName: string;
  hostPath: string;
  enabled?: boolean;
  now?: Date;
}

export const normalizeHostPath = (hostPath: string): string => path.resolve(hostPath);

export const createMediaRoot = (input: CreateMediaRootInput): MediaRoot => {
  const now = input.now ?? new Date();

  return {
    id: input.id ?? randomUUID(),
    displayName: input.displayName.trim(),
    hostPath: normalizeHostPath(input.hostPath),
    rootType: "mounted-filesystem",
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
};
