import type React from "react";
import { createContext, useContext } from "react";
import { toast } from "sonner";

type ToastContextType = {
  showToast: (message: string, severity?: "success" | "error" | "warning" | "info", duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const showToast = (message: string, severity: "success" | "error" | "warning" | "info" = "info", duration = 4000) => {
    switch (severity) {
      case "success":
        toast.success(message, { duration });
        break;
      case "error":
        toast.error(message, { duration });
        break;
      case "warning":
        toast.warning(message, { duration });
        break;
      case "info":
        toast.info(message, { duration });
        break;
    }
  };

  const showSuccess = (message: string, duration?: number) => showToast(message, "success", duration);
  const showError = (message: string, duration?: number) => showToast(message, "error", duration);
  const showWarning = (message: string, duration?: number) => showToast(message, "warning", duration);
  const showInfo = (message: string, duration?: number) => showToast(message, "info", duration);

  const value = { showToast, showSuccess, showError, showWarning, showInfo };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
