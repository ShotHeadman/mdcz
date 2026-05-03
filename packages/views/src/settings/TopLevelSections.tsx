import type { ReactNode } from "react";
import { SectionAnchor } from "./SectionAnchor";
import { useSettingsSearch } from "./SettingsSearchContext";
import { SettingsSectionModeProvider } from "./SettingsSectionModeContext";
import { SitePriorityEditorField } from "./SitePriorityEditorField";
import { Subsection } from "./Subsection";
import {
  AggregationBehaviorSection,
  AggregationPrioritySection,
  AggregationScrapeSection,
  AssetDownloadsSection,
  BehaviorSection,
  NamingSection,
  NetworkConnectionSection,
  NetworkCookiesSection,
  NfoSection,
  PathsSection,
  ScrapePacingSection,
  ShortcutsSection,
  TranslateSection,
  UiSection,
} from "./settingsContent";
import { type FieldAnchor, SECTION_LABELS } from "./settingsRegistry";

interface SiteOptionsProps {
  siteOptions: string[];
  forceOpen?: boolean;
}

interface SystemSectionProps {
  initialUseCustomTitleBar: boolean;
  forceOpen?: boolean;
}

const DEFERRED_SECTION_HEIGHTS = {
  scrape: 1040,
  network: 920,
  translate: 980,
  naming: 1260,
  download: 960,
  fileBehavior: 760,
  paths: 780,
  system: 840,
  advancedSettings: 1760,
} as const;

export function PathsTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="paths"
      label={SECTION_LABELS.paths}
      title={SECTION_LABELS.paths}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.paths}
    >
      <PathsSection />
    </SectionAnchor>
  );
}

export function ScrapeTopLevelSection({ siteOptions, forceOpen = false }: SiteOptionsProps) {
  return (
    <SectionAnchor
      id="scrape"
      label={SECTION_LABELS.scrape}
      title={SECTION_LABELS.scrape}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.scrape}
    >
      <Subsection title="刮削站点" description="启用网站、优先级与自定义地址" className="mb-6 last:mb-0">
        <SitePriorityEditorField options={siteOptions} />
      </Subsection>
      <Subsection title="刮削节奏" className="mb-6 last:mb-0">
        <ScrapePacingSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function NetworkTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="network"
      label={SECTION_LABELS.network}
      title={SECTION_LABELS.network}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.network}
    >
      <Subsection title="代理与请求" className="mb-6 last:mb-0">
        <NetworkConnectionSection />
      </Subsection>
      <Subsection title="站点凭证" className="mb-6 last:mb-0">
        <NetworkCookiesSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function TranslateTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="translate"
      label={SECTION_LABELS.translate}
      title={SECTION_LABELS.translate}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.translate}
    >
      <TranslateSection />
    </SectionAnchor>
  );
}

export function NamingTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="naming"
      label={SECTION_LABELS.naming}
      title={SECTION_LABELS.naming}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.naming}
    >
      <NamingSection />
    </SectionAnchor>
  );
}

export function DownloadTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="download"
      label={SECTION_LABELS.download}
      title={SECTION_LABELS.download}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.download}
    >
      <Subsection title="资源下载" className="mb-6 last:mb-0">
        <AssetDownloadsSection />
      </Subsection>
      <Subsection title="NFO" className="mb-6 last:mb-0">
        <NfoSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function FileBehaviorTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  return (
    <SectionAnchor
      id="fileBehavior"
      label={SECTION_LABELS.fileBehavior}
      title={SECTION_LABELS.fileBehavior}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.fileBehavior}
    >
      <BehaviorSection />
    </SectionAnchor>
  );
}

export function SystemTopLevelSection({ initialUseCustomTitleBar, forceOpen = false }: SystemSectionProps) {
  return (
    <SectionAnchor
      id="system"
      label={SECTION_LABELS.system}
      title={SECTION_LABELS.system}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.system}
    >
      <Subsection title="界面" className="mb-6 last:mb-0">
        <UiSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
      </Subsection>
      <Subsection title="快捷键" className="mb-6 last:mb-0">
        <ShortcutsSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function AdvancedTopLevelSection({ siteOptions, forceOpen = false }: SiteOptionsProps) {
  const search = useSettingsSearch();

  if (!search.hasVisibleAdvancedEntries) {
    return null;
  }

  return (
    <SectionAnchor
      id="advancedSettings"
      label="高级设置"
      title="高级设置"
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.advancedSettings}
    >
      <SettingsSectionModeProvider mode="advanced">
        <AdvancedDomainSubsection anchor="scrape">
          <AggregationPrioritySection siteOptions={siteOptions} />
          <AggregationScrapeSection />
          <AggregationBehaviorSection />
        </AdvancedDomainSubsection>

        <AdvancedDomainSubsection anchor="download">
          <AssetDownloadsSection />
        </AdvancedDomainSubsection>
      </SettingsSectionModeProvider>
    </SectionAnchor>
  );
}

function AdvancedDomainSubsection({ anchor, children }: { anchor: FieldAnchor; children: ReactNode }) {
  const search = useSettingsSearch();

  if (!search.isAdvancedAnchorVisible(anchor)) {
    return null;
  }

  return (
    <Subsection title={SECTION_LABELS[anchor]} className="mb-6 last:mb-0">
      {children}
    </Subsection>
  );
}
