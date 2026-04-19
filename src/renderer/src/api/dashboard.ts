import { ipc } from "@/client/ipc";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  recent: ["dashboard", "recent-acquisitions"] as const,
  output: ["dashboard", "output-summary"] as const,
};

export const fetchRecentAcquisitions = () => ipc.dashboard.getRecentAcquisitions();

export const fetchOutputSummary = () => ipc.dashboard.getOutputSummary();
