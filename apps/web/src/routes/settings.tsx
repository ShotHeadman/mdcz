import { type FieldAnchor, isFieldAnchor, SettingsPage } from "@mdcz/views/settings";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useConfigProfiles, useCurrentConfig, useDefaultConfig } from "../hooks/configQueries";
import { createProfileActions, createSettingsServices } from "./settingsController";

const SettingsRoute = () => {
  const { section } = Route.useSearch();
  const queryClient = useQueryClient();
  const configQ = useCurrentConfig();
  const defaultsQ = useDefaultConfig();
  const profilesQ = useConfigProfiles();
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
