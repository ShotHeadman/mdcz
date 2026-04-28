import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

function applyInitialTheme() {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem("vite-ui-theme");
  const preferredTheme =
    storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? storedTheme : "system";

  root.classList.remove("light", "dark");
  const resolvedTheme =
    preferredTheme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preferredTheme;
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
}

applyInitialTheme();

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
