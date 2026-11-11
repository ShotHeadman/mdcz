import { cn } from "@mdcz/ui";
import { Play } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";

// Only an explicit play creates the <video>. Clicking through results used to build and tear down a hardware
// decoder for every movie, the prime suspect for unkillable freezes on macOS.
export function TrailerPlayer({
  src,
  autoPlay = false,
  onError,
  className,
}: {
  src: string;
  autoPlay?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const t = useT();
  const [playing, setPlaying] = useState(autoPlay);

  return (
    <div className={cn("aspect-video overflow-hidden bg-black", className)}>
      {playing ? (
        // biome-ignore lint/a11y/useMediaCaption: Remote trailers do not provide a caption track.
        <video autoPlay controls src={src} onError={onError} className="h-full w-full" />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group flex h-full w-full flex-col items-center justify-center gap-3 text-white"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25 transition-colors group-hover:bg-white/25">
            <Play className="ml-1 h-6 w-6 fill-white" />
          </span>
          <span className="text-sm font-medium">{t.detail.playTrailer}</span>
        </button>
      )}
    </div>
  );
}
