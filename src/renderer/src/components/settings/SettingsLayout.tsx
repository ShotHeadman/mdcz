import { type ReactNode, useRef } from "react";
import { FloatingToc } from "./FloatingToc";
import { ProfileCapsule } from "./ProfileCapsule";
import { SettingsSearch } from "./SettingsSearch";
import { useOptionalSettingsSearch } from "./SettingsSearchContext";
import { TocProvider } from "./TocContext";

interface SettingsLayoutProps {
  searchDisabled?: boolean;
  profiles: string[];
  activeProfile: string | null;
  profileLoading?: boolean;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  onExportProfile: () => void;
  onImportProfile: () => void;
  children: ReactNode;
}

export function SettingsLayout({
  searchDisabled = false,
  profiles,
  activeProfile,
  profileLoading = false,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
  children,
}: SettingsLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const search = useOptionalSettingsSearch();
  const searchMetaText = (() => {
    if (search?.hasActiveFilters) {
      return `匹配 ${search.resultCount} 项`;
    }
    if (search?.isAdvancedVisible) {
      return "当前显示高级设置";
    }
    return "\u00a0";
  })();

  return (
    <TocProvider scrollContainerRef={scrollContainerRef}>
      <div className="flex h-full flex-col bg-surface-canvas">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-10 md:px-10">
            <div className="min-w-0 flex-1">
              <header className="flex justify-end">
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center gap-2.5">
                    <SettingsSearch disabled={searchDisabled} />
                    <ProfileCapsule
                      profiles={profiles}
                      activeProfile={activeProfile}
                      isLoading={profileLoading}
                      onSwitchProfile={onSwitchProfile}
                      onCreateProfile={onCreateProfile}
                      onDeleteProfile={onDeleteProfile}
                      onResetConfig={onResetConfig}
                      onExportProfile={onExportProfile}
                      onImportProfile={onImportProfile}
                    />
                  </div>
                  <div className="mt-1.5 min-h-[1rem] px-1 text-[11px] text-muted-foreground">{searchMetaText}</div>
                </div>
              </header>
              <div className="mt-6">{children}</div>
            </div>
            <FloatingToc />
          </div>
        </div>
      </div>
    </TocProvider>
  );
}
