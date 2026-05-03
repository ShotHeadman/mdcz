import { OverviewHeroStartCard as SharedOverviewHeroStartCard } from "@mdcz/views/overview";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";
import { useOutputSummary } from "@/hooks/useOverview";

type OverviewHeroStartCardProps = Pick<ComponentProps<typeof SharedOverviewHeroStartCard>, "className">;

export function OverviewHeroStartCard({ className }: OverviewHeroStartCardProps) {
  const navigate = useNavigate();
  const configQ = useCurrentConfig();
  const summaryQ = useOutputSummary();
  const currentPaths = configQ.data?.paths;
  const hasConfiguredOutput = Boolean(
    currentPaths?.outputSummaryPath?.trim() ||
      (currentPaths?.mediaPath?.trim() && currentPaths?.successOutputFolder?.trim()),
  );

  return (
    <SharedOverviewHeroStartCard
      className={className}
      data={summaryQ.data}
      hasConfiguredOutput={hasConfiguredOutput}
      isError={summaryQ.isError}
      isLoading={configQ.isLoading || summaryQ.isLoading}
      onSetup={() => navigate({ to: "/settings" })}
      onStart={() => navigate({ to: "/" })}
    />
  );
}
