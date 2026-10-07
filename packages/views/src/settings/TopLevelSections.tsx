import type { ReactNode } from "react";
import { useT } from "../i18n";
import { SectionAnchor } from "./SectionAnchor";
import { useSettingsSearch } from "./SettingsSearchContext";
import { SettingsSectionModeProvider } from "./SettingsSectionModeContext";
import { useSettingsServices } from "./SettingsServices";
import { SitePriorityEditorField } from "./SitePriorityEditorField";
import { Subsection } from "./Subsection";
import { MediaServerSection } from "./sections/MediaServerSections";
import {
  AggregationBehaviorSection,
  AggregationPrioritySection,
  AggregationScrapeSection,
  AssetDownloadsSection,
  AutomationSection,
  FilenameFilteringSection,
  NamingSection,
  NetworkConnectionSection,
  NetworkSiteAccessSection,
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

export function PathsTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="paths"
      label={t.settingsFields.sections.paths.label}
      title={t.settingsFields.sections.paths.label}
      forceOpen={forceOpen}
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
    >
      <Subsection title={t.settings.subsections.proxyAndRequests} className="mb-6 last:mb-0">
        <NetworkConnectionSection />
      </Subsection>
      <Subsection title={t.settings.subsections.siteAccess} className="mb-6 last:mb-0">
        <NetworkSiteAccessSection />
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

export function MediaServerTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  return (
    <SectionAnchor
      id="mediaServer"
      label={t.settingsFields.sections.mediaServer.label}
      title={t.settingsFields.sections.mediaServer.label}
      forceOpen={forceOpen}
    >
      <MediaServerSection />
    </SectionAnchor>
  );
}

/** Downloader path mappings and notifications; only the server receives callbacks and sends messages. */
export function AutomationTopLevelSection({ forceOpen = false }: { forceOpen?: boolean }) {
  const t = useT();
  const services = useSettingsServices();
  if ((services.settingsTarget ?? (services.isServer ? "server" : "desktop")) !== "server") return null;

  return (
    <SectionAnchor
      id="automation"
      label={t.settingsFields.sections.automation.label}
      title={t.settingsFields.sections.automation.label}
      forceOpen={forceOpen}
    >
      <AutomationSection />
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
