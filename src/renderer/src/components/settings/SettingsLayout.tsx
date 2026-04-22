import { type ReactNode, useRef } from "react";
import { FloatingToc } from "./FloatingToc";
import { ProfileCapsule } from "./ProfileCapsule";
import { SettingsSearch } from "./SettingsSearch";
import { TocProvider } from "./TocContext";

interface SettingsLayoutProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  profiles: string[];
  activeProfile: string;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  onExportProfile: () => void;
  onImportProfile: () => void;
  children: ReactNode;
}

export function SettingsLayout({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  profiles,
  activeProfile,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
  children,
}: SettingsLayoutProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <TocProvider scrollContainerRef={scrollContainerRef}>
      <div className="flex h-full flex-col bg-surface-canvas">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex max-w-6xl gap-6 px-6 pb-24 pt-10 md:px-10">
            <div className="min-w-0 flex-1">
              <SettingsHeader
                searchValue={searchValue}
                onSearchChange={onSearchChange}
                onSearchSubmit={onSearchSubmit}
                profiles={profiles}
                activeProfile={activeProfile}
                onSwitchProfile={onSwitchProfile}
                onCreateProfile={onCreateProfile}
                onDeleteProfile={onDeleteProfile}
                onResetConfig={onResetConfig}
                onExportProfile={onExportProfile}
                onImportProfile={onImportProfile}
              />
              <div className="mt-6">{children}</div>
            </div>
            <FloatingToc />
          </div>
        </div>
      </div>
    </TocProvider>
  );
}

interface SettingsHeaderProps extends Omit<SettingsLayoutProps, "children"> {}

function SettingsHeader({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  profiles,
  activeProfile,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
}: SettingsHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-end">
      <div className="flex items-center gap-2.5">
        <SettingsSearch value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} />
        <ProfileCapsule
          profiles={profiles}
          activeProfile={activeProfile}
          onSwitchProfile={onSwitchProfile}
          onCreateProfile={onCreateProfile}
          onDeleteProfile={onDeleteProfile}
          onResetConfig={onResetConfig}
          onExportProfile={onExportProfile}
          onImportProfile={onImportProfile}
        />
      </div>
    </header>
  );
}
