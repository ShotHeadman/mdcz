import { Search } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useT } from "../i18n";
import { AdvancedSettingsFooterContent } from "./SettingsFooter";
import { useSettingsSearch } from "./SettingsSearchContext";
import { useCrawlerSiteOptions } from "./settingsContent";
import type { FieldAnchor } from "./settingsRegistry";
import { useToc } from "./TocContext";
import {
  AdvancedTopLevelSection,
  AutomationTopLevelSection,
  DownloadTopLevelSection,
  MediaServerTopLevelSection,
  NamingTopLevelSection,
  NetworkTopLevelSection,
  PathsTopLevelSection,
  ScrapeTopLevelSection,
  SystemTopLevelSection,
  TranslateTopLevelSection,
} from "./TopLevelSections";

interface SettingsFormProps {
  extraContent?: ReactNode;
  flatDefaults: Record<string, unknown>;
  initialUseCustomTitleBar: boolean;
  initialSection?: FieldAnchor;
}

export function SettingsForm({
  extraContent,
  flatDefaults,
  initialUseCustomTitleBar,
  initialSection,
}: SettingsFormProps) {
  const siteOptions = useCrawlerSiteOptions(flatDefaults);
  const search = useSettingsSearch();
  const { scrollToSection } = useToc();

  useEffect(() => {
    if (initialSection) scrollToSection(initialSection, "instant");
  }, [initialSection, scrollToSection]);

  return (
    <div className="space-y-12">
      {search.hasActiveFilters && search.resultCount === 0 ? (
        <SettingsEmptyState />
      ) : (
        <>
          <PathsTopLevelSection />
          <ScrapeTopLevelSection siteOptions={siteOptions} />
          <NetworkTopLevelSection />
          <TranslateTopLevelSection />
          <NamingTopLevelSection />
          <DownloadTopLevelSection />
          <MediaServerTopLevelSection />
          <AutomationTopLevelSection />
          <SystemTopLevelSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
          <AdvancedTopLevelSection siteOptions={siteOptions} />
        </>
      )}

      {extraContent}
      <AdvancedSettingsFooter />
    </div>
  );
}

function SettingsEmptyState() {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-quiet-xl)] border border-border/40 bg-surface px-6 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-low text-muted-foreground">
        <Search className="h-5 w-5" />
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium text-foreground">{t.settings.layout.noMatches}</p>
      </div>
    </div>
  );
}

function AdvancedSettingsFooter() {
  const search = useSettingsSearch();

  return (
    <AdvancedSettingsFooterContent
      hasActiveFilters={search.hasActiveFilters}
      isAdvancedVisible={search.isAdvancedVisible}
      onToggleShowAdvanced={search.toggleShowAdvanced}
    />
  );
}
