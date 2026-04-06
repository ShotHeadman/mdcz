import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateConfig } from "@/client/api";
import { ipc } from "@/client/ipc";
import type { UpdateConfigData } from "@/client/types";
import { TabbedConfigForm } from "@/components/config-form/TabbedConfigForm";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useCurrentConfig } from "@/hooks/useCurrentConfig";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const toFieldErrors = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }

  return String(error);
};

const getValidationErrorState = (error: unknown): { fields: string[]; fieldErrors: Record<string, string> } => {
  if (!isRecord(error)) {
    return { fields: [], fieldErrors: {} };
  }

  const details = isRecord(error.details) ? error.details : undefined;
  const rootFields = toStringArray(error.fields);
  const rootFieldErrors = toFieldErrors(error.fieldErrors);

  return {
    fields: rootFields.length > 0 ? rootFields : toStringArray(details?.fields),
    fieldErrors: Object.keys(rootFieldErrors).length > 0 ? rootFieldErrors : toFieldErrors(details?.fieldErrors),
  };
};

function SettingsComponent() {
  const queryClient = useQueryClient();
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDialogOpen, setNewProfileDialogOpen] = useState(false);
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileName, setDeleteProfileName] = useState("");

  const configQ = useCurrentConfig({
    refetchOnWindowFocus: false,
  });

  const configInfoQ = useQuery({
    queryKey: ["config", "info"],
    queryFn: async () => ipc.config.list(),
    refetchOnWindowFocus: false,
  });

  const profilesQ = useQuery({
    queryKey: ["config", "profiles"],
    queryFn: async () => ipc.config.listProfiles(),
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: async (data: NonNullable<UpdateConfigData["body"]>) => {
      return updateConfig({ body: data, throwOnError: true });
    },
    onSuccess: () => {
      setServerErrors([]);
      setServerFieldErrors({});
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast.success("设置已保存");
    },
    onError: (error) => {
      const { fields, fieldErrors } = getValidationErrorState(error);
      if (fields.length > 0) {
        setServerErrors(fields);
        setServerFieldErrors(fieldErrors);
        const firstMessage =
          (Object.keys(fieldErrors).length > 0 &&
            fields.map((field) => fieldErrors[field]).find((item) => Boolean(item))) ??
          undefined;
        toast.error(firstMessage ? `校验失败：${firstMessage}` : `校验失败：${fields.length} 个字段有误`);
      } else {
        setServerErrors([]);
        setServerFieldErrors({});
        toast.error(`保存失败: ${getErrorMessage(error)}`);
      }
    },
  });

  const handleReset = async () => {
    try {
      await ipc.config.reset();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setServerErrors([]);
      setServerFieldErrors({});
      toast.success("已恢复默认设置");
      setResetDialogOpen(false);
    } catch (error) {
      toast.error(`重置失败: ${getErrorMessage(error)}`);
    }
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    try {
      await ipc.config.createProfile(name);
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      toast.success(`配置档案 "${name}" 已创建`);
      setNewProfileName("");
      setNewProfileDialogOpen(false);
    } catch (error) {
      toast.error(`创建失败: ${getErrorMessage(error)}`);
    }
  };

  const handleSwitchProfile = async (name: string) => {
    if (isDirty) {
      toast.warning("请先保存或放弃当前修改，再切换配置档案");
      return;
    }
    try {
      await ipc.config.switchProfile(name);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      queryClient.invalidateQueries({ queryKey: ["config", "info"] });
      setServerErrors([]);
      setServerFieldErrors({});
      toast.success(`已切换到配置档案 "${name}"`);
    } catch (error) {
      toast.error(`切换失败: ${getErrorMessage(error)}`);
    }
  };

  const handleDeleteProfile = async () => {
    if (!deleteProfileName) return;
    try {
      await ipc.config.deleteProfile(deleteProfileName);
      queryClient.invalidateQueries({ queryKey: ["config", "profiles"] });
      toast.success("配置档案已删除");
      setDeleteProfileDialogOpen(false);
      setDeleteProfileName("");
    } catch (error) {
      toast.error(`删除失败: ${getErrorMessage(error)}`);
    }
  };

  const onDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), []);

  // T11: Unsaved changes guard
  const { proceed, reset, status } = useBlocker({
    condition: isDirty,
  });

  const profiles = profilesQ.data?.profiles ?? [];
  const activeProfile = profilesQ.data?.active ?? "";

  const deletableProfiles = useMemo(
    () => profiles.filter((profile) => profile !== activeProfile),
    [profiles, activeProfile],
  );

  useEffect(() => {
    if (!deleteProfileDialogOpen) {
      return;
    }
    if (!deleteProfileName || !deletableProfiles.includes(deleteProfileName)) {
      setDeleteProfileName(deletableProfiles[0] ?? "");
    }
  }, [deleteProfileDialogOpen, deleteProfileName, deletableProfiles]);

  if (configQ.isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (configQ.isError) {
    return <div className="p-4 text-destructive">Error loading settings.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {configQ.data && (
          <TabbedConfigForm
            key={activeProfile || "default"}
            data={configQ.data}
            onSubmit={(data) => mutation.mutateAsync(data as NonNullable<UpdateConfigData["body"]>)}
            serverErrors={serverErrors}
            serverFieldErrors={serverFieldErrors}
            onDirtyChange={onDirtyChange}
            profiles={profiles}
            activeProfile={activeProfile}
            onSwitchProfile={handleSwitchProfile}
            onCreateProfile={() => setNewProfileDialogOpen(true)}
            onDeleteProfile={() => setDeleteProfileDialogOpen(true)}
            onResetConfig={() => setResetDialogOpen(true)}
            configPath={configInfoQ.data?.configPath}
          />
        )}
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复默认设置</DialogTitle>
            <DialogDescription>确定要将所有设置恢复为默认值吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleReset}>
              确定恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New profile dialog */}
      <Dialog open={newProfileDialogOpen} onOpenChange={setNewProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建配置档案</DialogTitle>
            <DialogDescription>输入新配置档案的名称，将以默认设置创建。</DialogDescription>
          </DialogHeader>
          <Input
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="配置档案名称"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateProfile();
            }}
          />
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleCreateProfile} disabled={!newProfileName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete profile dialog */}
      <Dialog open={deleteProfileDialogOpen} onOpenChange={setDeleteProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除配置档案</DialogTitle>
            <DialogDescription>选择要删除的配置档案（当前档案不可删除）。</DialogDescription>
          </DialogHeader>
          <Select value={deleteProfileName} onValueChange={setDeleteProfileName}>
            <SelectTrigger>
              <SelectValue placeholder="选择配置档案" />
            </SelectTrigger>
            <SelectContent>
              {deletableProfiles.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDeleteProfile} disabled={!deleteProfileName}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* T11: Navigation blocker dialog */}
      <Dialog
        open={status === "blocked"}
        onOpenChange={(open) => {
          if (!open) reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>未保存的更改</DialogTitle>
            <DialogDescription>您有未保存的设置更改。确定要离开吗？未保存的更改将会丢失。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" onClick={() => reset?.()}>
                继续编辑
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => proceed?.()}>
              放弃更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
