import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@mdcz/shared/actorSource";
import {
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  TextField,
  UrlField,
} from "../../config-form/FieldRenderer";
import { useHasRenderableFields } from "../sectionVisibility";

const PERSON_SYNC_SHARED_FIELD_KEYS = ["personSync.personOverviewSources", "personSync.personImageSources"] as const;

export function PersonSyncSharedSection() {
  const hasRenderableFields = useHasRenderableFields(PERSON_SYNC_SHARED_FIELD_KEYS);
  if (!hasRenderableFields) return null;

  return (
    <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">共享人物资料源</h4>
        <p className="text-xs text-muted-foreground">
          同时服务 Jellyfin 和 Emby。人物简介会按顺序选择一个质量达标的主资料源。
        </p>
      </div>
      <ChipArrayFieldWrapper
        name="personSync.personOverviewSources"
        label="人物简介来源顺序"
        options={[...ACTOR_OVERVIEW_SOURCE_OPTIONS]}
      />
      <ChipArrayFieldWrapper
        name="personSync.personImageSources"
        label="人物头像来源顺序"
        options={[...ACTOR_IMAGE_SOURCE_OPTIONS]}
      />
    </div>
  );
}

export function JellyfinSection() {
  return (
    <>
      <UrlField name="jellyfin.url" label="Jellyfin 服务器地址" />
      <CookieFieldWrapper name="jellyfin.apiKey" label="Jellyfin API Key" />
      <TextField
        name="jellyfin.userId"
        label="Jellyfin 用户 ID"
        description="必须是 UUID。用于人物列表读取，留空则按服务端默认处理。"
      />
      <BoolField
        name="jellyfin.refreshPersonAfterSync"
        label="同步后刷新人物"
        description="同步简介或头像后，额外请求 Jellyfin 刷新人物元数据与图片。"
      />
      <BoolField
        name="jellyfin.lockOverviewAfterSync"
        label="同步后锁定人物简介"
        description="写入简介后把 Overview 加入 LockedFields，降低被 Jellyfin 元数据刷新覆盖的概率。"
      />
    </>
  );
}

export function EmbySection() {
  return (
    <>
      <UrlField name="emby.url" label="Emby 服务器地址" />
      <CookieFieldWrapper name="emby.apiKey" label="Emby API Key" />
      <TextField name="emby.userId" label="Emby 用户 ID" description="用于人物列表读取，留空则按服务端默认处理。" />
      <BoolField
        name="emby.refreshPersonAfterSync"
        label="同步后刷新人物"
        description="同步简介或头像后，额外请求 Emby 刷新人物元数据与图片。"
      />
    </>
  );
}
