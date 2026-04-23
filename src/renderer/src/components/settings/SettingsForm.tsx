import { Search, SlidersHorizontal } from "lucide-react";
import { useSettingsSearch } from "./SettingsSearchContext";
import { useCrawlerSiteOptions } from "./settingsContent";
import {
  AdvancedTopLevelSection,
  DataSourcesSection,
  ExtractionRulesSection,
  PathsTopLevelSection,
  RateLimitingSection,
  SystemTopLevelSection,
} from "./TopLevelSections";

interface SettingsFormProps {
  flatDefaults: Record<string, unknown>;
  initialUseCustomTitleBar: boolean;
}

export function SettingsForm({ flatDefaults, initialUseCustomTitleBar }: SettingsFormProps) {
  const siteOptions = useCrawlerSiteOptions(flatDefaults);
  const search = useSettingsSearch();

  return (
    <div className="space-y-12">
      {search.hasActiveFilters && search.resultCount === 0 ? (
        <SettingsEmptyState />
      ) : (
        <>
          <DataSourcesSection siteOptions={siteOptions} forceOpen={search.isSectionForceOpen("dataSources")} />
          <RateLimitingSection forceOpen={search.isSectionForceOpen("rateLimiting")} />
          <ExtractionRulesSection forceOpen={search.isSectionForceOpen("extractionRules")} />
          <PathsTopLevelSection forceOpen={search.isSectionForceOpen("paths")} />
          <SystemTopLevelSection
            initialUseCustomTitleBar={initialUseCustomTitleBar}
            forceOpen={search.isSectionForceOpen("system")}
          />
          <AdvancedTopLevelSection
            siteOptions={siteOptions}
            forceOpen={search.isSectionForceOpen("advancedSettings")}
          />
        </>
      )}

      <AdvancedSettingsFooter />
    </div>
  );
}

function SettingsEmptyState() {
  return (
    <div className="rounded-[var(--radius-quiet-xl)] border border-border/40 bg-surface px-6 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-low text-muted-foreground">
        <Search className="h-5 w-5" />
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium text-foreground">没有匹配的设置</p>
        <p className="text-sm leading-6 text-muted-foreground">
          试试更短的关键字，或检查是否需要显示高级设置后再搜索。
        </p>
      </div>
    </div>
  );
}

function AdvancedSettingsFooter() {
  const search = useSettingsSearch();
  const actionLabel = search.isAdvancedVisible ? "隐藏高级设置" : "显示高级设置";

  return (
    <div className="flex justify-end pt-2">
      <button
        type="button"
        onClick={search.toggleShowAdvanced}
        className="inline-flex items-center gap-2 rounded-[var(--radius-quiet-capsule)] bg-surface-low px-3.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <span>{actionLabel}</span>
      </button>
    </div>
  );
}
