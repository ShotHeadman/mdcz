import { Loader2 } from "lucide-react";

export function BootFallback({ message = "Loading..." }: { message?: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "hsl(var(--background, 240 5% 96%))",
        color: "hsl(var(--foreground, 240 10% 4%))",
        zIndex: 2147483647,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: 0.2,
        }}
      >
        <Loader2 size={18} style={{ animation: "spin 0.8s linear infinite" }} />
        <span>{message}</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
