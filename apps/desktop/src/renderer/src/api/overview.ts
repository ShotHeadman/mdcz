import { ipc } from "@/client/ipc";

export const overviewKeys = {
  all: ["overview"] as const,
  recent: ["overview", "recent-acquisitions"] as const,
  output: ["overview", "output-summary"] as const,
};

export const fetchRecentAcquisitions = () => ipc.overview.getRecentAcquisitions();

export const fetchOutputSummary = () => ipc.overview.getOutputSummary();
