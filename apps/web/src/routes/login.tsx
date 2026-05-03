import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "./__root";

// Web-only route: login protects the remote WebUI/server surface. Desktop is a local Electron client and does not
// expose an equivalent browser session.
export const Route = createFileRoute("/login")({
  component: LoginPage,
});
