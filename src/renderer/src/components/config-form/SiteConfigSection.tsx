import type { Website } from "@shared/enums";
import { useQuery } from "@tanstack/react-query";
import type { FieldValues } from "react-hook-form";
import { useFormContext } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { Row } from "@/components/shared/Row";
import { Input } from "@/components/ui/Input";

interface SiteInfo {
  site: Website;
  name: string;
  enabled: boolean;
  native: boolean;
}

export function SiteConfigSection() {
  const form = useFormContext<FieldValues>();

  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: SiteInfo[] };
      return result.sites;
    },
  });

  const enabledSites = (sitesQ.data ?? []).filter((s) => s.enabled);
  if (enabledSites.length === 0) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="px-1">
        <h2 className="text-xl font-bold tracking-tight mb-1 text-foreground">站点配置</h2>
        <p className="text-muted-foreground text-sm">为每个已启用站点设置自定义 URL</p>
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden divide-y divide-border/50">
        {enabledSites.map((site) => {
          const urlKey = `scrape.siteConfigs.${site.site}.customUrl`;
          const urlValue = (form.watch(urlKey) as string) ?? "";

          return (
            <Row key={site.site} variant="form" label={site.name}>
              <div className="flex items-center gap-6 flex-1 justify-end">
                <Input
                  value={urlValue}
                  onChange={(e) => form.setValue(urlKey, e.target.value, { shouldDirty: true })}
                  placeholder="默认 URL（留空使用内置地址）"
                  className="h-8 text-sm bg-background/50 focus:bg-background transition-all max-w-[320px]"
                />
              </div>
            </Row>
          );
        })}
      </div>
    </div>
  );
}
