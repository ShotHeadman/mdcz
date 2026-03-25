import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { readNfo, updateNfo } from "@/api/manual";
import type { DetailViewItem } from "@/components/detail/types";
import { useResolvedImageCandidates } from "@/hooks/useResolvedImageSources";
import { buildImageSourceCandidates } from "@/utils/image";
import { getDirFromPath } from "@/utils/path";

export function useDetailViewController(item?: DetailViewItem | null) {
  const [nfoOpen, setNfoOpen] = useState(false);
  const [nfoPath, setNfoPath] = useState("");
  const [nfoContent, setNfoContent] = useState("");
  const [nfoLoading, setNfoLoading] = useState(false);
  const [nfoSaving, setNfoSaving] = useState(false);
  const [posterSrc, setPosterSrc] = useState("");
  const [thumbSrc, setThumbSrc] = useState("");
  const [posterCandidateIndex, setPosterCandidateIndex] = useState(0);
  const [thumbCandidateIndex, setThumbCandidateIndex] = useState(0);

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
  const posterRenderableCandidates = useResolvedImageCandidates([posterCandidates.primary, posterCandidates.fallback]);
  const thumbRenderableCandidates = useResolvedImageCandidates([thumbCandidates.primary, thumbCandidates.fallback]);

  useEffect(() => {
    if (posterCandidates.primary || posterCandidates.fallback) {
      setPosterCandidateIndex(0);
      return;
    }

    setPosterCandidateIndex(0);
  }, [posterCandidates.fallback, posterCandidates.primary]);

  useEffect(() => {
    if (thumbCandidates.primary || thumbCandidates.fallback) {
      setThumbCandidateIndex(0);
      return;
    }

    setThumbCandidateIndex(0);
  }, [thumbCandidates.fallback, thumbCandidates.primary]);

  useEffect(() => {
    setPosterSrc(posterRenderableCandidates[posterCandidateIndex] ?? "");
  }, [posterCandidateIndex, posterRenderableCandidates]);

  useEffect(() => {
    setThumbSrc(thumbRenderableCandidates[thumbCandidateIndex] ?? "");
  }, [thumbCandidateIndex, thumbRenderableCandidates]);

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
    setPosterCandidateIndex((currentIndex) => Math.min(currentIndex + 1, posterRenderableCandidates.length));
  }, [posterRenderableCandidates.length]);

  const handleThumbError = useCallback(() => {
    setThumbCandidateIndex((currentIndex) => Math.min(currentIndex + 1, thumbRenderableCandidates.length));
  }, [thumbRenderableCandidates.length]);

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
