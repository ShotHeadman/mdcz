import { toErrorMessage } from "@mdcz/shared/error";
import { useEffect, useMemo } from "react";
import type { FieldValues } from "react-hook-form";
import { useForm } from "react-hook-form";
import { ConfigFieldLayoutProvider } from "@/components/config-form/FieldRenderer";
import { EmbySection, JellyfinSection, PersonSyncSharedSection } from "@/components/settings/settingsContent";
import { flattenConfig } from "@/components/settings/settingsRegistry";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Form } from "@/components/ui/Form";
import { SettingsEditorAutosaveProvider, valuesEqual } from "@/hooks/useAutoSaveField";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";
import { cn } from "@/lib/utils";

export type PersonServer = "jellyfin" | "emby";

interface PersonServerSettingsDialogProps {
  open: boolean;
  server: PersonServer;
  onOpenChange: (open: boolean) => void;
}

const DIALOG_CONTENT_CLASS_NAME =
  "w-[92vw] max-w-3xl gap-0 overflow-hidden rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-0 shadow-[0_32px_90px_-40px_rgba(15,23,42,0.45)]";

export function PersonServerSettingsDialog({ open, server, onOpenChange }: PersonServerSettingsDialogProps) {
  const configQ = useCurrentConfig({
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const flatConfigValues = useMemo(() => flattenConfig(configQ.data ?? {}), [configQ.data]);
  const form = useForm<FieldValues>({
    defaultValues: flatConfigValues,
    mode: "onChange",
  });
  const serverName = server === "jellyfin" ? "Jellyfin" : "Emby";

  useEffect(() => {
    if (!configQ.data || valuesEqual(form.getValues(), flatConfigValues)) {
      return;
    }

    form.reset(flatConfigValues);
  }, [configQ.data, flatConfigValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CONTENT_CLASS_NAME}>
        <DialogHeader className="gap-3 px-7 pt-7 pb-4 text-left">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">人物同步配置</p>
          <DialogTitle className="text-2xl font-semibold tracking-tight">{serverName} 连接设置</DialogTitle>
        </DialogHeader>

        <div className="max-h-[min(72vh,760px)] overflow-y-auto border-y border-border/45 px-6 py-6">
          {!configQ.data && !configQ.isError ? (
            <DialogStateMessage title="正在读取当前配置" />
          ) : configQ.isError ? (
            <DialogStateMessage title="配置加载失败" description={toErrorMessage(configQ.error)} tone="error" />
          ) : (
            <Form {...form}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                }}
              >
                <SettingsEditorAutosaveProvider savedValues={flatConfigValues}>
                  <ConfigFieldLayoutProvider layout="vertical">
                    <div className="space-y-6">
                      <PersonSyncSharedSection />
                      <section className="space-y-4 rounded-[var(--radius-quiet-lg)] bg-surface-low/90 p-4 md:p-5">
                        <header className="space-y-1">
                          <h3 className="font-numeric text-lg font-semibold tracking-[-0.02em] text-foreground">
                            {serverName}
                          </h3>
                          <p className="text-sm leading-6 text-muted-foreground">
                            连接诊断和人物同步会读取这里保存的服务器地址、API Key 与用户 ID。
                          </p>
                        </header>
                        <div className="space-y-3">{server === "jellyfin" ? <JellyfinSection /> : <EmbySection />}</div>
                      </section>
                    </div>
                  </ConfigFieldLayoutProvider>
                </SettingsEditorAutosaveProvider>
              </form>
            </Form>
          )}
        </div>

        <DialogFooter className="gap-2 px-6 pb-6 pt-5">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-[var(--radius-quiet-capsule)] px-5">
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogStateMessage({
  title,
  description,
  tone = "muted",
}: {
  title: string;
  description?: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-quiet-lg)] bg-surface-low px-5 py-8 text-center text-sm",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <div className="font-medium text-foreground">{title}</div>
      {description ? <div className="mt-2 leading-6">{description}</div> : null}
    </div>
  );
}
