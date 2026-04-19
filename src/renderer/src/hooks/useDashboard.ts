import { useQuery } from "@tanstack/react-query";
import { dashboardKeys, fetchOutputSummary, fetchRecentAcquisitions } from "@/api/dashboard";

export const useRecentAcquisitions = () =>
  useQuery({
    queryKey: dashboardKeys.recent,
    queryFn: fetchRecentAcquisitions,
    staleTime: 5 * 60_000,
  });

export const useOutputSummary = () =>
  useQuery({
    queryKey: dashboardKeys.output,
    queryFn: fetchOutputSummary,
    staleTime: 60_000,
  });
