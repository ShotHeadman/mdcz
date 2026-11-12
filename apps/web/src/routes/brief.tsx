import { BriefPage } from "@mdcz/views/brief";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useWebBriefPort } from "../adapters/briefPort";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";

export function BriefRoutePage() {
  const navigate = useNavigate();
  const port = useWebBriefPort();
  const configQ = useQuery({ queryKey: queryKeys.config.current, queryFn: () => api.config.read() });
  const enabled = configQ.data?.llm.brief === true;

  // Turning Brief off removes the page with the sidebar item.
  useEffect(() => {
    if (configQ.data && !enabled) void navigate({ to: "/overview", replace: true });
  }, [configQ.data, enabled, navigate]);

  return enabled ? <BriefPage port={port} /> : null;
}

export const Route = createFileRoute("/brief")({
  component: BriefRoutePage,
});
