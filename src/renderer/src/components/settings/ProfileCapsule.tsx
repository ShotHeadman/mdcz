import { Check, ChevronDown, Download, type LucideIcon, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

interface ProfileCapsuleProps {
  profiles: string[];
  activeProfile: string;
  onSwitchProfile: (name: string) => void;
  onCreateProfile: () => void;
  onDeleteProfile: () => void;
  onResetConfig: () => void;
  onExportProfile: () => void;
  onImportProfile: () => void;
  className?: string;
}

export function ProfileCapsule({
  profiles,
  activeProfile,
  onSwitchProfile,
  onCreateProfile,
  onDeleteProfile,
  onResetConfig,
  onExportProfile,
  onImportProfile,
  className,
}: ProfileCapsuleProps) {
  const [open, setOpen] = useState(false);
  const hasOtherProfiles = profiles.filter((p) => p !== activeProfile).length > 0;
  const visibleProfiles = profiles.filter((p) => p.length > 0);
  const displayName = activeProfile || "默认配置";
  const runAction = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-[var(--radius-quiet-capsule)] bg-surface-low px-4 text-sm",
          "text-foreground outline-none transition-colors hover:bg-surface-raised",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
          className,
        )}
      >
        <span className="max-w-[140px] truncate font-medium">{displayName}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 rounded-[var(--radius-quiet-lg)] border border-border/40 bg-surface-floating p-2 shadow-[0_24px_70px_-32px_rgba(15,23,42,0.45)]"
      >
        {visibleProfiles.length > 0 && (
          <div className="space-y-0.5 pb-2">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              配置档案
            </div>
            {visibleProfiles.map((profile) => {
              const isActive = profile === activeProfile;
              return (
                <button
                  key={profile}
                  type="button"
                  onClick={() => runAction(() => onSwitchProfile(profile))}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[var(--radius-quiet-sm)] px-2 py-1.5 text-left text-sm outline-none",
                    "transition-colors hover:bg-surface-low focus-visible:bg-surface-low",
                    isActive && "bg-surface-low",
                  )}
                >
                  <span className="truncate">{profile}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-foreground" />}
                </button>
              );
            })}
          </div>
        )}
        <div className="h-px bg-border/50" />
        <div className="space-y-0.5 pt-2">
          <MenuAction icon={Plus} label="新建配置档案" onClick={() => runAction(onCreateProfile)} />
          <MenuAction icon={Upload} label="导入 JSON 档案..." onClick={() => runAction(onImportProfile)} />
          <MenuAction icon={Download} label="导出当前档案..." onClick={() => runAction(onExportProfile)} />
          {hasOtherProfiles && (
            <MenuAction icon={Trash2} label="删除配置档案..." onClick={() => runAction(onDeleteProfile)} />
          )}
          <MenuAction icon={RotateCcw} label="恢复默认设置" onClick={() => runAction(onResetConfig)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MenuActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

function MenuAction({ icon: Icon, label, onClick }: MenuActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--radius-quiet-sm)] px-2 py-1.5 text-left text-sm outline-none",
        "transition-colors hover:bg-surface-low focus-visible:bg-surface-low",
      )}
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}
