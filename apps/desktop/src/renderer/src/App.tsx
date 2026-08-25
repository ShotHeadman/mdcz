import "./index.css";
import { Toaster, TooltipProvider } from "@mdcz/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { Suspense } from "react";
import { BootFallback } from "./components/BootFallback";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { useIpcSync } from "./hooks/useIpcSync";
import { useStylesReady } from "./hooks/useStylesReady";
import { queryClient } from "./lib/queryClient";
import { routeTree } from "./routeTree.gen";

const shouldUseHashHistory = typeof window !== "undefined" && window.location.protocol === "file:";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  ...(shouldUseHashHistory ? { history: createHashHistory() } : {}),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  const { runtimeReady, runtimeError } = useIpcSync(queryClient);
  const stylesReady = useStylesReady();

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
