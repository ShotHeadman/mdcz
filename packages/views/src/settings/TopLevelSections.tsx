import type { ReactNode } from "react";
import { useT } from "../i18n";
import { SectionAnchor } from "./SectionAnchor";
import { useSettingsSearch } from "./SettingsSearchContext";
import { SettingsSectionModeProvider } from "./SettingsSectionModeContext";
import { useSettingsServices } from "./SettingsServices";
import { SitePriorityEditorField } from "./SitePriorityEditorField";
import { Subsection } from "./Subsection";
import {
  AggregationBehaviorSection,
  AggregationPrioritySection,
  AggregationScrapeSection,
  AssetDownloadsSection,
  FilenameFilteringSection,
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
import type { FieldAnchor } from "./settingsRegistry";

interface SiteOptionsProps {
  siteOptions: string[];
  forceOpen?: boolean;
}

interface SystemSectionProps {
  initialUseCustomTitleBar: boolean;
  forceOpen?: boolean;
}

const DEFERRED_SECTION_HEIGHTS = {
  paths: 1400,
  scrape: 1040,
  network: 920,
  translate: 980,
  naming: 1260,
  download: 960,
  system: 840,
  advancedSettings: 1760,
} as const;

export function PathsTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="paths"
      label={t.settingsFields.sections.paths.label}
      title={t.settingsFields.sections.paths.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.paths}
    >
      <PathsSection />
    </SectionAnchor>
  );
}

export function ScrapeTopLevelSection({ siteOptions, forceOpen = false }: SiteOptionsProps) {
  const t = useT();
  return (
    <SectionAnchor
      id="scrape"
      label={t.settingsFields.sections.scrape.label}
      title={t.settingsFields.sections.scrape.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.scrape}
    >
      <Subsection
        title={t.settings.subsections.scrapeSites}
        description={t.settings.subsections.scrapeSitesDescription}
        className="mb-6 last:mb-0"
      >
        <SitePriorityEditorField options={siteOptions} />
      </Subsection>
      <Subsection title={t.settings.subsections.scrapePacing} className="mb-6 last:mb-0">
        <ScrapePacingSection />
      </Subsection>
      <Subsection title={t.settings.subsections.filenameFiltering} className="mb-6 last:mb-0">
        <FilenameFilteringSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function NetworkTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="network"
      label={t.settingsFields.sections.network.label}
      title={t.settingsFields.sections.network.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.network}
    >
      <Subsection title={t.settings.subsections.proxyAndRequests} className="mb-6 last:mb-0">
        <NetworkConnectionSection />
      </Subsection>
      <Subsection title={t.settings.subsections.siteCredentials} className="mb-6 last:mb-0">
        <NetworkCookiesSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function TranslateTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="translate"
      label={t.settingsFields.sections.translate.label}
      title={t.settingsFields.sections.translate.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.translate}
    >
      <TranslateSection />
    </SectionAnchor>
  );
}

export function NamingTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="naming"
      label={t.settingsFields.sections.naming.label}
      title={t.settingsFields.sections.naming.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.naming}
    >
      <NamingSection />
    </SectionAnchor>
  );
}

export function DownloadTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="download"
      label={t.settingsFields.sections.download.label}
      title={t.settingsFields.sections.download.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.download}
    >
      <Subsection title={t.settings.subsections.assetDownloads} className="mb-6 last:mb-0">
        <AssetDownloadsSection />
      </Subsection>
      <Subsection title="NFO" className="mb-6 last:mb-0">
        <NfoSection />
      </Subsection>
    </SectionAnchor>
  );
}

export function SystemTopLevelSection({ initialUseCustomTitleBar, forceOpen = false }: SystemSectionProps) {
  const t = useT();
  const services = useSettingsServices();
  const target = services.settingsTarget ?? (services.isServer ? "server" : "desktop");

  if (target === "server") {
    return null;
  }

  return (
    <SectionAnchor
      id="system"
      label={t.settingsFields.sections.system.label}
      title={t.settingsFields.sections.system.label}
      forceOpen={forceOpen}
      deferContent
      estimatedContentHeight={DEFERRED_SECTION_HEIGHTS.system}
    >
      <Subsection title={t.settings.subsections.interface} className="mb-6 last:mb-0">
        <UiSection initialUseCustomTitleBar={initialUseCustomTitleBar} />
      </Subsection>
      {!services.isServer ? (
        <Subsection title={t.settings.subsections.shortcuts} className="mb-6 last:mb-0">
          <ShortcutsSection />
        </Subsection>
      ) : null}
    </SectionAnchor>
  );
}

export function AdvancedTopLevelSection({ siteOptions, forceOpen = false }: SiteOptionsProps) {
  const t = useT();
  const search = useSettingsSearch();

  if (!search.hasVisibleAdvancedEntries) {
    return null;
  }

  return (
    <SectionAnchor
      id="advancedSettings"
      label={t.settings.subsections.advanced}
      title={t.settings.subsections.advanced}
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
  const t = useT();
  const search = useSettingsSearch();

  if (!search.isAdvancedAnchorVisible(anchor)) {
    return null;
  }

  return (
    <Subsection title={t.settingsFields.sections[anchor].label} className="mb-6 last:mb-0">
      {children}
    </Subsection>
  );
}
