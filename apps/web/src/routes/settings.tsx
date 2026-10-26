import { type FieldAnchor, isFieldAnchor, SettingsPage } from "@mdcz/views/settings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { createProfileActions, createSettingsServices } from "./settingsController";

const SettingsRoute = () => {
  const { section } = Route.useSearch();
  const queryClient = useQueryClient();
  const configQ = useQuery({ queryKey: queryKeys.config.current, queryFn: () => api.config.read() });
  const defaultsQ = useQuery({
    queryKey: queryKeys.config.defaults,
    queryFn: () => api.config.defaults(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profilesQ = useQuery({ queryKey: queryKeys.config.profiles, queryFn: () => api.config.profiles.list() });
  const services = useMemo(() => createSettingsServices(queryClient), [queryClient]);
  const profileActions = useMemo(() => createProfileActions(queryClient), [queryClient]);

  return (
    <SettingsPage
      config={configQ.data}
      configError={configQ.error}
      defaultConfig={defaultsQ.data}
      profiles={profilesQ.data}
      profilesLoading={profilesQ.isLoading}
      services={services}
      profileActions={profileActions}
      initialSection={section}
    />
  );
};

export const Route = createFileRoute("/settings")({
  validateSearch: (search): { section?: FieldAnchor } => ({
    section: isFieldAnchor(search.section) ? search.section : undefined,
  }),
  component: SettingsRoute,
});
