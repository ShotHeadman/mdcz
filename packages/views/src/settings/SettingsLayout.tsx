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
  const hasFilterBadge = search?.hasActiveFilters || search?.isAdvancedVisible;
  const headerMetaContent = (() => {
    if (search?.hasActiveFilters) {
      return `匹配 ${search.resultCount} 项`;
    }
    if (search?.isAdvancedVisible) {
      return "显示高级设置";
    }
    return null;
  })();

  return (
    <TocProvider scrollContainerRef={scrollContainerRef}>
      <div className="flex h-full flex-col bg-surface-canvas overflow-hidden">
        {/* Sticky / Fixed Header with Search & Profile Capsule */}
        <header className="sticky top-0 z-30 shrink-0 border-b border-border/40 bg-surface-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3 md:px-10">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="font-numeric text-base font-bold tracking-tight text-foreground select-none">设置</h1>
              {hasFilterBadge && headerMetaContent && (
                <span className="inline-flex items-center rounded-full bg-surface-low border border-border/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground animate-in fade-in duration-200">
                  {headerMetaContent}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
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
          </div>
        </header>

        {/* Main Scrollable Content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-8 md:px-10">
            <div className="min-w-0 flex-1">{children}</div>
            <FloatingToc />
          </div>
        </div>
      </div>
    </TocProvider>
  );
}
