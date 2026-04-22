import type { Website } from "@shared/enums";
import { useQuery } from "@tanstack/react-query";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { SiteConnectivityPill } from "@/components/settings/SiteConnectivityPill";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { BaseField } from "./FieldRenderer";

interface SiteInfo {
  site: Website;
  name: string;
  enabled: boolean;
  native: boolean;
}

interface SiteConfigSectionProps {
  sitesOverride?: string[];
}

export function SiteConfigSection({ sitesOverride }: SiteConfigSectionProps) {
  const form = useFormContext<FieldValues>();
  const sites =
    (useWatch({
      control: form.control,
      name: "scrape.sites",
    }) as Website[] | undefined) ?? [];

  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: SiteInfo[] };
      return result.sites;
    },
    staleTime: 60_000,
  });

  const visibleSites = [...new Set((sitesOverride ?? sites) as Website[])];
  const siteInfoMap = new Map((sitesQ.data ?? []).map((site) => [site.site, site]));

  if (visibleSites.length === 0) return null;

  return (
    <div className="space-y-1">
      {visibleSites.map((site) => {
        const urlKey = `scrape.siteConfigs.${site}.customUrl`;
        const siteInfo = siteInfoMap.get(site);

        return (
          <BaseField key={site} name={urlKey} label={siteInfo?.name ?? site} commitMode="debounce">
            {(field) => (
              <FormControl>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    {...field}
                    value={(field.value as string) ?? ""}
                    placeholder="默认 URL（留空使用内置地址）"
                    className="h-8 min-w-[240px] flex-1 text-sm bg-background/50 transition-all focus:bg-background"
                  />
                  <SiteConnectivityPill site={site} />
                </div>
              </FormControl>
            )}
          </BaseField>
        );
      })}
    </div>
  );
}
