import { Toaster, TooltipProvider } from "@mdcz/ui";
import { ConfirmDialogHost } from "@mdcz/views/common";
import { ThemeProvider, useTheme } from "@mdcz/views/shell";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { syncTitleBarTheme } from "./desktop";
import { queryClient } from "./lib/queryClient";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Bottom-right keeps toasts clear of the native window controls; neutral colors keep the app's palette.
const AppToaster = () => <Toaster position="bottom-right" theme={useTheme().theme} />;

export const AppRouter = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider onResolvedThemeChange={syncTitleBarTheme}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <AppToaster />
        <ConfirmDialogHost />
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);
