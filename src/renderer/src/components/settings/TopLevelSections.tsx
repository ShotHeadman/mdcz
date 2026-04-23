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
  EmbySection,
  JellyfinSection,
  NamingSection,
  NetworkCookiesSection,
  NfoSection,
  PathsSection,
  ScrapePacingSection,
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  ShortcutsSection,
  TranslateSection,
  UiSection,
} from "./settingsContent";

interface SiteOptionsProps {
  siteOptions: string[];
}

interface SystemSectionProps {
  initialUseCustomTitleBar: boolean;
}

export function DataSourcesSection({ siteOptions }: SiteOptionsProps) {
  return (
    <SectionAnchor
      id="dataSources"
      label={SECTION_LABELS.dataSources}
      title={SECTION_LABELS.dataSources}
      description={SECTION_DESCRIPTIONS.dataSources}
    >
      <Subsection title="刮削站点" description="启用网站、优先级、每站 URL 与站点凭证">
        <SitePriorityEditorField options={siteOptions} />
        <NetworkCookiesSection />
      </Subsection>
      <Subsection title="翻译">
        <TranslateSection />
      </Subsection>
      <Subsection title="人物同步 · Jellyfin" description="Jellyfin 连接与同步入口">
        <JellyfinSection />
      </Subsection>
      <Subsection title="人物同步 · Emby">
        <EmbySection />
      </Subsection>
    </SectionAnchor>
  );
}

export function RateLimitingSection() {
  return (
    <SectionAnchor
      id="rateLimiting"
      label={SECTION_LABELS.rateLimiting}
      title={SECTION_LABELS.rateLimiting}
      description={SECTION_DESCRIPTIONS.rateLimiting}
    >
      <Subsection title="刮削节奏">
        <ScrapePacingSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function ExtractionRulesSection() {
  return (
    <SectionAnchor
      id="extractionRules"
      label={SECTION_LABELS.extractionRules}
      title={SECTION_LABELS.extractionRules}
      description={SECTION_DESCRIPTIONS.extractionRules}
    >
      <Subsection title="命名模板">
        <NamingSection />
      </Subsection>
      <Subsection title="资源下载">
        <AssetDownloadsSection />
      </Subsection>
      <Subsection title="NFO">
        <NfoSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function PathsTopLevelSection() {
  return (
    <SectionAnchor
      id="paths"
      label={SECTION_LABELS.paths}
      title={SECTION_LABELS.paths}
      description={SECTION_DESCRIPTIONS.paths}
    >
      <PathsSection />
    </SectionAnchor>
  );
}

export function SystemTopLevelSection({ initialUseCustomTitleBar }: SystemSectionProps) {
  return (
    <SectionAnchor
      id="system"
      label={SECTION_LABELS.system}
      title={SECTION_LABELS.system}
      description={SECTION_DESCRIPTIONS.system}
    >
      <Subsection title="界面">
        <UiSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
      </Subsection>
      <Subsection title="快捷键">
        <ShortcutsSection />
      </Subsection>
      <Subsection title="文件行为">
        <BehaviorSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function AdvancedTopLevelSection({ siteOptions }: SiteOptionsProps) {
  const search = useSettingsSearch();

  if (!search.hasVisibleAdvancedEntries) {
    return null;
  }

  return (
    <SectionAnchor
      id="advancedSettings"
      label="高级设置"
      title="高级设置"
      description="只在当前浏览会话临时显示的专家级选项，按原有领域归类，离开页面后会恢复默认浏览模式。"
    >
      <SettingsSectionModeProvider mode="advanced">
        <AdvancedDomainSubsection anchor="dataSources">
          <AggregationPrioritySection siteOptions={siteOptions} />
        </AdvancedDomainSubsection>

        <AdvancedDomainSubsection anchor="rateLimiting">
          <AggregationScrapeSection />
        </AdvancedDomainSubsection>

        <AdvancedDomainSubsection anchor="extractionRules">
          <AggregationBehaviorSection />
          <AssetDownloadsSection />
        </AdvancedDomainSubsection>
      </SettingsSectionModeProvider>
    </SectionAnchor>
  );
}

function AdvancedDomainSubsection({ anchor, children }: { anchor: keyof typeof SECTION_LABELS; children: ReactNode }) {
  const search = useSettingsSearch();

  if (!search.isAdvancedAnchorVisible(anchor)) {
    return null;
  }

  return (
    <Subsection title={SECTION_LABELS[anchor]} description={SECTION_DESCRIPTIONS[anchor]}>
      {children}
    </Subsection>
  );
}
