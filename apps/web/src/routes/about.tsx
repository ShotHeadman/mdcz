import { AboutView } from "@mdcz/views/about";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import AppLogo from "@/assets/images/logo.png";
import { api } from "../client";

export const AboutPage = () => {
  const aboutQ = useQuery({ queryKey: ["system", "about"], queryFn: () => api.system.about(), retry: false });

  return (
    <AboutView
      about={aboutQ.data}
      logoSrc={AppLogo}
      loading={aboutQ.isLoading}
      updateCheck={false}
      onOpenExternal={(url) => window.open(url, "_blank", "noopener,noreferrer")}
    />
  );
};

export const Route = createFileRoute("/about")({
  component: AboutPage,
});
