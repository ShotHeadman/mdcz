import type { Website } from "@mdcz/shared/enums";
import type { SiteHealth } from "@mdcz/shared/siteResults";
import { Button } from "@mdcz/ui";
import { TriangleAlert } from "lucide-react";
import { type Messages, useT } from "../i18n";

export const describeSiteHealth = (t: Messages, site: string, health: SiteHealth) => {
  const reason = t.domain.failureReasons[health.reason];
  return {
    summary:
      health.until === undefined
        ? t.domain.siteHealth.unavailable(site, reason)
        : t.domain.siteHealth.paused(site, reason, new Date(health.until).toLocaleTimeString()),
    remedy: t.domain.siteHealth.remedies[health.reason],
  };
};

export interface SiteHealthCardProps {
  sites: ReadonlyArray<{ site: Website; enabled: boolean; health?: SiteHealth }>;
  onOpenSettings: () => void;
}

/** Lists enabled sites the current network cannot reach, so failures explain themselves before a scrape. */
export function SiteHealthCard({ sites, onOpenSettings }: SiteHealthCardProps) {
  const t = useT();
  const affected = sites.flatMap(({ site, enabled, health }) => (enabled && health ? [{ site, health }] : []));
  if (affected.length === 0) return null;

  return (
    <section className="col-span-12 rounded-quiet-xl bg-amber-500/10 p-6 text-foreground md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TriangleAlert className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-bold tracking-tight">{t.domain.siteHealth.title}</h2>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onOpenSettings}>
          {t.domain.siteHealth.openSettings}
        </Button>
      </div>
      <ul className="mt-4 space-y-2 text-sm leading-6">
        {affected.map(({ site, health }) => {
          const { summary, remedy } = describeSiteHealth(t, site, health);
          return (
            <li key={site}>
              <span className="font-medium">{summary}</span>
              {remedy && <span className="text-muted-foreground"> {remedy}</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t.domain.siteHealth.recheck}</p>
    </section>
  );
}
