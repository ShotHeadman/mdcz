import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { readNfo, updateNfo } from "@/api/manual";
import type { DetailViewItem } from "@/components/detail/types";
import { buildImageSourceCandidates, getImageSrc } from "@/utils/image";

function getDirFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return filePath;
  return filePath.slice(0, slash);
}

function toRenderableSrc(path: string | undefined): string {
  if (!path) {
    return "";
  }

  return getImageSrc(path);
}

export function useDetailViewController(item?: DetailViewItem | null) {
  const [nfoOpen, setNfoOpen] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoContent, setNfoContent] = useState("");
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const [posterSrc, setPosterSrc] = useState("");
  const [thumbSrc, setThumbSrc] = useState("");

  const posterCandidates = useMemo(
    () =>
      buildImageSourceCandidates({
        remotePath: item?.posterUrl,
        filePath: item?.path,
        outputPath: item?.outputPath,
        fileName: "poster.jpg",
      }),
    [item?.outputPath, item?.path, item?.posterUrl],
  );

  const thumbCandidates = useMemo(
    () =>
      buildImageSourceCandidates({
        remotePath: item?.thumbUrl ?? item?.fanartUrl,
        filePath: item?.path,
        outputPath: item?.outputPath,
        fileName: "thumb.jpg",
      }),
    [item?.fanartUrl, item?.outputPath, item?.path, item?.thumbUrl],
  );

  useEffect(() => {
    setPosterSrc(toRenderableSrc(posterCandidates.primary));
  }, [posterCandidates.primary]);

  useEffect(() => {
    setThumbSrc(toRenderableSrc(thumbCandidates.primary));
  }, [thumbCandidates.primary]);

  const openNfoEditor = useCallback(async (path: string) => {
    try {
      setNfoLoading(true);
      const response = await readNfo(path);
      setNfoPath(response.data?.path ?? path);
      setNfoContent(response.data?.content ?? "");
      setNfoOpen(true);
    } catch {
      toast.error("加载 NFO 失败");
    } finally {
      setNfoLoading(false);
    }
  }, []);

  const handleSaveNfo = useCallback(async () => {
    try {
      setNfoSaving(true);
      await updateNfo(nfoPath, nfoContent, item?.path);
      toast.success("NFO 已保存");
      setNfoOpen(false);
    } catch {
      toast.error("保存 NFO 失败");
    } finally {
      setNfoSaving(false);
    }
  }, [item?.path, nfoContent, nfoPath]);

  const handlePlay = useCallback(() => {
    if (!item?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(item.path);
    } else {
      toast.info("播放功能仅在桌面模式下可用");
    }
  }, [item?.path]);

  const handleOpenFolder = useCallback(() => {
    if (!item?.path) {
      toast.info("请先选择一个项目");
      return;
    }
    if (window.electron?.openPath) {
      window.electron.openPath(getDirFromPath(item.path));
    } else {
      toast.info("打开文件夹功能仅在桌面模式下可用");
    }
  }, [item?.path]);

  const handleOpenNfo = useCallback(async () => {
    const path = item?.nfoPath ?? item?.path;
    if (!path) {
      toast.info("请先选择一个项目");
      return;
    }
    await openNfoEditor(path);
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  const handlePosterError = useCallback(() => {
    const localPoster = toRenderableSrc(posterCandidates.fallback);
    if (localPoster && localPoster !== posterSrc) {
      setPosterSrc(localPoster);
    }
  }, [posterCandidates.fallback, posterSrc]);

  const handleThumbError = useCallback(() => {
    const localThumb = toRenderableSrc(thumbCandidates.fallback);
    if (localThumb && localThumb !== thumbSrc) {
      setThumbSrc(localThumb);
    }
  }, [thumbCandidates.fallback, thumbSrc]);

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ path?: string }>;
      const path = custom.detail?.path || item?.nfoPath || item?.path;
      if (!path) return;
      void openNfoEditor(path);
    };

    window.addEventListener("app:open-nfo", listener);
    return () => {
      window.removeEventListener("app:open-nfo", listener);
    };
  }, [item?.nfoPath, item?.path, openNfoEditor]);

  return {
    posterSrc,
    thumbSrc,
    nfoOpen,
    nfoContent,
    nfoLoading,
    nfoSaving,
    setNfoOpen,
    setNfoContent,
    handlePlay,
    handleOpenFolder,
    handleOpenNfo,
    handlePosterError,
    handleThumbError,
    handleSaveNfo,
  };
}
