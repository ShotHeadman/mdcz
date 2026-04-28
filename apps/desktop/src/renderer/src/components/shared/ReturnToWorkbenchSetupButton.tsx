import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

interface ReturnToWorkbenchSetupButtonProps {
  className?: string;
  disabled?: boolean;
  dialogDescription?: string;
  dialogTitle?: string;
  onConfirm: () => void;
}

export function ReturnToWorkbenchSetupButton({
  className,
  disabled = false,
  dialogDescription = "返回后会清空当前工作台内容，确定继续吗？",
  dialogTitle = "返回工作台初始页面",
  onConfirm,
}: ReturnToWorkbenchSetupButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("rounded-quiet-capsule", className)}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="返回工作台初始页面"
        title="返回工作台初始页面"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              确认返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
