import { Toaster, TooltipProvider } from "@mdcz/ui";
import { ConfirmDialogHost } from "@mdcz/views/common";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./lib/queryClient";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const AppRouter = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
      <ConfirmDialogHost />
    </TooltipProvider>
  </QueryClientProvider>
);
