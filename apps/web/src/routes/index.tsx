import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "./overview";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});
