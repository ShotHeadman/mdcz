import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";
import { RotateCcw, Save } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PosterCropEditSession } from "../adapters/ports";

interface PosterCropDialogProps {
  open: boolean;
  session: PosterCropEditSession | null;
  crop: NormalizedCropRegion | null;
  saving: boolean;
  onCropChange: (crop: NormalizedCropRegion) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export function PosterCropDialog({
  open,
  session,
  crop,
  saving,
  onCropChange,
  onOpenChange,
  onSave,
}: PosterCropDialogProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; crop: NormalizedCropRegion } | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (open && session) setZoom(1);
  }, [open, session]);
  const previewStyle = useMemo(
    () =>
      crop
        ? {
            width: `${100 / crop.width}%`,
            height: `${100 / crop.height}%`,
            left: `${(-crop.x / crop.width) * 100}%`,
            top: `${(-crop.y / crop.height) * 100}%`,
          }
        : undefined,
    [crop],
  );

  const reset = () => {
    if (!session) return;
    setZoom(1);
    onCropChange(session.initialCrop);
  };

  const changeZoom = (nextZoom: number) => {
    if (!session || !crop) return;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    const width = session.initialCrop.width / nextZoom;
    const height = session.initialCrop.height / nextZoom;
    setZoom(nextZoom);
    onCropChange({
      x: clamp(centerX - width / 2, 0, 1 - width),
      y: clamp(centerY - height / 2, 0, 1 - height),
      width,
      height,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!crop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    onCropChange({
      ...drag.crop,
      x: clamp(drag.crop.x + (event.clientX - drag.x) / bounds.width, 0, 1 - drag.crop.width),
      y: clamp(drag.crop.y + (event.clientY - drag.y) / bounds.height, 0, 1 - drag.crop.height),
    });
  };

  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleCropKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!crop) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta =
      event.key === "ArrowLeft"
        ? { x: -step, y: 0 }
        : event.key === "ArrowRight"
          ? { x: step, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -step }
            : event.key === "ArrowDown"
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    event.preventDefault();
    onCropChange({
      ...crop,
      x: clamp(crop.x + delta.x, 0, 1 - crop.width),
      y: clamp(crop.y + delta.y, 0, 1 - crop.height),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="tracking-normal">编辑封面</DialogTitle>
          <DialogDescription>拖动选区调整位置，使用缩放控制取景范围。</DialogDescription>
        </DialogHeader>
        {session && crop ? (
          <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-3">
              <div
                ref={canvasRef}
                className="relative mx-auto max-h-[58vh] w-full max-w-3xl overflow-hidden rounded-quiet-lg bg-black/90 select-none"
                style={{ aspectRatio: `${session.width} / ${session.height}` }}
              >
                <img
                  src={session.sourceUrl}
                  alt="封面裁剪源图"
                  className="absolute inset-0 h-full w-full"
                  draggable={false}
                />
                <button
                  type="button"
                  aria-label="封面裁剪区域"
                  className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.58)] outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={stopDragging}
                  onPointerCancel={stopDragging}
                  onKeyDown={handleCropKeyDown}
                >
                  <span className="absolute inset-1 border border-white/40" />
                </button>
              </div>
              <div className="flex items-center gap-3 rounded-quiet bg-surface-low/70 px-3 py-2.5">
                <span className="text-xs font-medium text-muted-foreground">缩放</span>
                <input
                  aria-label="封面缩放"
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(event) => changeZoom(Number(event.currentTarget.value))}
                  className="h-2 min-w-0 flex-1 accent-foreground"
                />
                <span className="w-10 text-right font-numeric text-xs text-muted-foreground">{zoom.toFixed(1)}x</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">预览</div>
              <div className="relative mx-auto aspect-2/3 w-full max-w-[220px] overflow-hidden rounded-quiet-lg bg-surface-low">
                <img
                  src={session.sourceUrl}
                  alt="封面裁剪预览"
                  className="absolute max-w-none"
                  style={previewStyle}
                  draggable={false}
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                输出比例 2:3 · {Math.round(crop.width * session.width)} x {Math.round(crop.height * session.height)}
              </p>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={reset} disabled={saving || !session}>
            <RotateCcw />
            重置
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button type="button" onClick={onSave} disabled={saving || !crop}>
            <Save />
            {saving ? "保存中..." : "保存封面"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
