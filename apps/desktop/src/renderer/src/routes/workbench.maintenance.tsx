import { createFileRoute } from "@tanstack/react-router";
import { DesktopWorkbenchRoute } from "./workbench";

export const Route = createFileRoute("/workbench/maintenance")({
  component: () => <DesktopWorkbenchRoute routeIntent="maintenance" />,
});
