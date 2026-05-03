import { Toaster } from "@mdcz/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { queryClient } from "./lib/queryClient";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

export const AppRouter = () => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    <Toaster richColors position="top-right" />
  </QueryClientProvider>
);
