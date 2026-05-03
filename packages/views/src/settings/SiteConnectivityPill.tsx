import type { Website } from "@mdcz/shared/enums";
import { Button, cn } from "@mdcz/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FieldValues } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { useSettingsInFlightSaves, useSettingsServices } from "./SettingsServices";

type ConnectivityState =
  | { kind: "idle"; message: string }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface SiteConnectivityPillProps {
  site: Website;
}

const STATUS_LABELS: Record<ConnectivityState["kind"], string> = {
  idle: "",
  loading: "检测中",
  success: "正常",
  error: "异常",
};

export function SiteConnectivityPill({ site }: SiteConnectivityPillProps) {
  const form = useFormContext<FieldValues>();
  const services = useSettingsServices();
  const inFlightSaves = useSettingsInFlightSaves();
  const [state, setState] = useState<ConnectivityState>({
    kind: "idle",
    message: "尚未检测站点连通性",
  });
  const hasMountedRef = useRef(false);
  const requestVersionRef = useRef(0);

  const [proxyType, proxy, useProxy, javdbCookie, javbusCookie] =
    (useWatch({
      control: form.control,
      name: ["network.proxyType", "network.proxy", "network.useProxy", "network.javdbCookie", "network.javbusCookie"],
    }) as [string | undefined, string | undefined, boolean | undefined, string | undefined, string | undefined]) ?? [];
  const probeDependencyKey = [proxyType, proxy, useProxy, javdbCookie, javbusCookie].join("::");

  useEffect(() => {
    void probeDependencyKey;

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    requestVersionRef.current += 1;
    setState({
      kind: "idle",
      message: "配置已变更，请重新检测",
    });
  }, [probeDependencyKey]);

  const handleProbe = async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState({
      kind: "loading",
      message: "正在检测站点连通性",
    });

    try {
      const result = await services.probeSiteConnectivity(site);
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setState({
        kind: result.ok ? "success" : "error",
        message: result.message,
      });
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }

      setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const disabled = state.kind === "loading" || inFlightSaves > 0;
  const disabledTitle = inFlightSaves > 0 ? "等待自动保存完成后再测试" : state.message;

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={handleProbe}
        title={disabledTitle}
        className="rounded-[var(--radius-quiet-capsule)] px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        测试
      </Button>
      <span
        title={state.message}
        hidden={state.kind === "idle"}
        className={cn(
          "inline-flex min-w-[64px] items-center justify-center gap-1 rounded-[var(--radius-quiet-capsule)] px-2.5 py-1 text-[11px] font-medium",
          state.kind === "loading" && "bg-surface-low text-foreground",
          state.kind === "success" && "bg-emerald-500/10 text-emerald-700",
          state.kind === "error" && "bg-rose-500/10 text-rose-700",
        )}
      >
        {state.kind === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
        <span>{STATUS_LABELS[state.kind]}</span>
      </span>
    </div>
  );
}
