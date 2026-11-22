import { BriefPage, useBriefStore } from "@mdcz/views/brief";
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
  const hasCells = useBriefStore((state) => state.cells.length > 0);
  const enabled = configQ.data?.llm.brief === true;
  // Keep Brief open while the page already holds cells (for example, after switching to a profile where Brief is off),
  // so the completed row and its Undo button stay reachable until the user clears or leaves.
  const visible = enabled || hasCells;

  useEffect(() => {
    if (configQ.data && !visible) void navigate({ to: "/overview", replace: true });
  }, [configQ.data, visible, navigate]);

  return visible ? <BriefPage port={port} /> : null;
}

export const Route = createFileRoute("/brief")({
  component: BriefRoutePage,
});
