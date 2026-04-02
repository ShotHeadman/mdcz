import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ipc } from "./client/ipc";
import { BootFallback } from "./components/BootFallback";
import { Toaster } from "./components/ui/Sonner";
import { TooltipProvider } from "./components/ui/Tooltip";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { useIpcSync } from "./hooks/useIpcSync";
import { useStylesReady } from "./hooks/useStylesReady";
import { routeTree } from "./routeTree.gen";
import { useScrapeStore } from "./store/scrapeStore";
import { useUIStore } from "./store/uiStore";

const shouldUseHashHistory = typeof window !== "undefined" && window.location.protocol === "file:";

const router = createRouter({
  routeTree,
  ...(shouldUseHashHistory ? { history: createHashHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  const queryClient = useMemo(() => new QueryClient(), []);
  const { runtimeReady, runtimeError } = useIpcSync();
  const stylesReady = useStylesReady();
  const recoveryCheckedRef = useRef(false);

  useEffect(() => {
    if (!runtimeReady || recoveryCheckedRef.current) {
      return;
    }

    recoveryCheckedRef.current = true;
    if (useScrapeStore.getState().scrapeStatus !== "idle") {
      return;
    }

    void (async () => {
      try {
        const { recoverable, pendingCount, failedCount } = await ipc.scraper.getRecoverableSession();
        if (!recoverable) {
          return;
        }

        const shouldRecover = window.confirm(
          `检测到上次未完成的刮削任务。\n待处理 ${pendingCount} 个，失败 ${failedCount} 个。\n选择“确定”恢复任务，选择“取消”放弃上次任务。`,
        );
        useScrapeStore.getState().reset();
        useUIStore.getState().setSelectedResultId(null);

        if (!shouldRecover) {
          const result = await ipc.scraper.resolveRecoverableSession("discard");
          toast.info(result.message);
          return;
        }

        const result = await ipc.scraper.resolveRecoverableSession("recover");
        useScrapeStore.getState().setScraping(true);
        useScrapeStore.getState().setScrapeStatus("running");
        toast.success(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`处理恢复任务失败: ${message}`);
      }
    })();
  }, [runtimeReady]);

  if (runtimeError) {
    return <BootFallback message={runtimeError} />;
  }

  if (!runtimeReady || !stylesReady) {
    return <BootFallback message={stylesReady ? "Starting app..." : "Loading styles..."} />;
  }

  return (
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Suspense fallback={<BootFallback message="Loading page..." />}>
              <RouterProvider router={router} />
            </Suspense>
            <Toaster />
          </ToastProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
};

export default App;
