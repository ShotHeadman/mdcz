import { useQuery } from "@tanstack/react-query";
import { fetchOutputSummary, fetchRecentAcquisitions, overviewKeys } from "@/api/overview";

export const useRecentAcquisitions = () =>
  useQuery({
    queryKey: overviewKeys.recent,
    queryFn: fetchRecentAcquisitions,
    staleTime: 5 * 60_000,
  });

export const useOutputSummary = () =>
  useQuery({
    queryKey: overviewKeys.output,
    queryFn: fetchOutputSummary,
    staleTime: 60_000,
  });
