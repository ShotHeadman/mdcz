import { OverviewMaintenanceCard as SharedOverviewMaintenanceCard } from "@mdcz/views/overview";
import { useNavigate } from "@tanstack/react-router";

export function OverviewMaintenanceCard() {
  const navigate = useNavigate();

  return <SharedOverviewMaintenanceCard onOpen={() => navigate({ to: "/", search: { intent: "maintenance" } })} />;
}
