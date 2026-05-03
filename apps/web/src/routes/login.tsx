import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "./__root";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});
