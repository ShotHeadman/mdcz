import type { MediaLibraryDto, MediaLibrarySettingsInput } from "@mdcz/shared/mediaLibrary";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import { Badge, Button, cn, quietPanelSurfaceClass } from "@mdcz/ui";
import { AlertCircle, FolderCog, FolderInput, FolderOutput, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { confirmDialog } from "../common";
import { useT } from "../i18n";
import type { PathAutocompleteResult } from "../path";
import { LibraryEditorDialog } from "./LibraryEditorDialog";

export interface LibrariesViewProps {
  libraries: MediaLibraryDto[];
  loading?: boolean;
  errorMessage?: string | null;
  /** Server only: automation levels and discovery need the always-on server. */
  showAutomation: boolean;
  accessPanel?: ReactNode;
  onCreate: (settings: MediaLibrarySettingsInput) => Promise<void>;
  onUpdate: (id: string, settings: MediaLibrarySettingsInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPreviewNaming: (settings: MediaLibrarySettingsInput) => Promise<NamingPreviewItem[]>;
  loadDirectorySuggestions?: (path: string) => Promise<PathAutocompleteResult>;
  browseDirectory?: () => Promise<string | null>;
}

export function LibrariesView({
  libraries,
  loading = false,
  errorMessage,
  showAutomation,
  accessPanel,
  onCreate,
  onUpdate,
  onDelete,
  onPreviewNaming,
  loadDirectorySuggestions,
  browseDirectory,
}: LibrariesViewProps) {
  const t = useT();
  const [editing, setEditing] = useState<MediaLibraryDto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const openEditor = (library: MediaLibraryDto | null) => {
    setEditing(library);
    setEditorOpen(true);
  };

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-8 lg:px-12 lg:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-1">
            <h1 className="text-xl font-bold tracking-tight">{t.libraries.title}</h1>
            <p className="text-sm text-muted-foreground">{t.libraries.description}</p>
          </div>
          {libraries.length > 0 ? (
            <Button onClick={() => openEditor(null)}>
              <Plus className="h-4 w-4" />
              {t.libraries.add}
            </Button>
          ) : null}
        </header>

        {errorMessage ? (
          <div className="flex items-center gap-3 rounded-quiet border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t.libraries.loadFailed(errorMessage)}
          </div>
        ) : null}

        {!loading && libraries.length === 0 && !errorMessage ? (
          <section
            className={cn(
              quietPanelSurfaceClass,
              "flex flex-col items-center gap-4 rounded-quiet-xl px-6 py-12 text-center",
            )}
          >
            <FolderCog className="h-10 w-10 text-muted-foreground/40" />
            <div className="max-w-md space-y-1">
              <h2 className="text-base font-bold">{t.libraries.createFirst}</h2>
              <p className="text-sm text-muted-foreground">{t.libraries.createFirstDescription}</p>
            </div>
            <Button onClick={() => openEditor(null)}>
              <Plus className="h-4 w-4" />
              {t.libraries.createFirst}
            </Button>
          </section>
        ) : null}

        <section className="grid gap-4">
          {libraries.map((library) => (
            <article key={library.id} className={cn(quietPanelSurfaceClass, "rounded-quiet-xl p-5")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold tracking-tight">{library.name}</h2>
                    <Badge variant="secondary">{t.libraries.placements[library.placement].label}</Badge>
                    {showAutomation ? (
                      <Badge variant="outline">
                        {library.automation === "off"
                          ? t.libraries.card.automationOff
                          : t.libraries.automationLevels[library.automation].label}
                      </Badge>
                    ) : null}
                  </div>
                  <PathLine icon={<FolderInput className="h-3.5 w-3.5" />} label={t.libraries.card.source}>
                    {library.sourcePath}
                  </PathLine>
                  <PathLine icon={<FolderOutput className="h-3.5 w-3.5" />} label={t.libraries.card.output}>
                    {library.placement === "inPlace" ? t.libraries.card.noOutput : library.outputPath}
                  </PathLine>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditor(library)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t.libraries.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: t.libraries.deleteTitle(library.name),
                          description: t.libraries.deleteDescription,
                          destructive: true,
                        })
                      )
                        await onDelete(library.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t.libraries.delete}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </section>

        {accessPanel}
      </div>
      <LibraryEditorDialog
        open={editorOpen}
        library={editing}
        showAutomation={showAutomation}
        onOpenChange={setEditorOpen}
        onSave={async (settings) => {
          if (editing) await onUpdate(editing.id, settings);
          else await onCreate(settings);
        }}
        onPreviewNaming={onPreviewNaming}
        loadDirectorySuggestions={loadDirectorySuggestions}
        browseDirectory={browseDirectory}
      />
    </main>
  );
}

function PathLine({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="shrink-0 font-semibold">{label}</span>
      <span className="truncate font-mono" title={typeof children === "string" ? children : undefined}>
        {children}
      </span>
    </div>
  );
}
