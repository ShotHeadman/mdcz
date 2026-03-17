import { parse } from "node:path";

export const isGeneratedSidecarVideo = (filePath: string): boolean => parse(filePath).name.toLowerCase() === "trailer";
