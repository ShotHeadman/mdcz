import { Website } from "@mdcz/shared/enums";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mdcz/ui";
import { Plus, Trash2 } from "lucide-react";
import { type Dispatch, type ReactNode, type SetStateAction, useId } from "react";
import { useT } from "../i18n";
import type { EditableActorProfile, EditableNfoData, NfoValidationErrors } from "./nfoEditorModel";

interface NfoEditorDialogProps {
  open: boolean;
  data: EditableNfoData;
  errors: NfoValidationErrors;
  dirty: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDataChange: Dispatch<SetStateAction<EditableNfoData>>;
  onSave: () => void;
}

type TextFieldKey = {
  [Key in keyof EditableNfoData]: EditableNfoData[Key] extends string ? Key : never;
}[keyof EditableNfoData];

const WEBSITE_OPTIONS = Object.values(Website);

const FIELD_CLASS = "space-y-1.5";
const LABEL_CLASS = "text-[11px] font-semibold text-muted-foreground";

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="text-xs leading-5 text-destructive">{message}</p>;
}

function TextField({
  label,
  value,
  error,
  disabled,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  disabled?: boolean;
  type?: "text" | "number";
  onChange: (value: string) => void;
}) {
  const inputId = useId();

  return (
    <div className={FIELD_CLASS}>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        {label}
      </label>
      <Input
        id={inputId}
        type={type}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError message={error} />
    </div>
  );
}

function TextareaField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const textareaId = useId();

  return (
    <div className={FIELD_CLASS}>
      <label htmlFor={textareaId} className={LABEL_CLASS}>
        {label}
      </label>
      <Textarea
        id={textareaId}
        value={value}
        disabled={disabled}
        autoSize={false}
        className="min-h-28 resize-y"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-4 border-t border-border/50 pt-5 first:border-t-0 first:pt-0", className)}>
      <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground/85 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function StringListField({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const visibleValues = values.length > 0 ? values : [""];

  const updateValue = (index: number, nextValue: string) => {
    const nextValues = [...visibleValues];
    nextValues[index] = nextValue;
    onChange(nextValues);
  };

  const t = useT();
  const removeValue = (index: number) => {
    onChange(visibleValues.filter((_, valueIndex) => valueIndex !== index));
  };

  return (
    <div className={FIELD_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <span className={LABEL_CLASS}>{label}</span>
        <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange([...values, ""])}>
          <Plus className="h-3.5 w-3.5" />
          {t.nfo.editor.add}
        </Button>
      </div>
      <div className="space-y-2">
        {visibleValues.map((value, index) => (
          // Keyed by position: NFO array rows have no persisted IDs and are edited in place.
          <div key={index} className="flex gap-2">
            <Input
              value={value}
              disabled={disabled}
              onChange={(event) => updateValue(index, event.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={t.nfo.editor.deleteItemAria(label, index + 1)}
              onClick={() => removeValue(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActorProfilesField({
  values,
  error,
  disabled,
  onChange,
}: {
  values: EditableActorProfile[];
  error?: string;
  disabled?: boolean;
  onChange: (values: EditableActorProfile[]) => void;
}) {
  const t = useT();
  const visibleValues = values.length > 0 ? values : [{ name: "", photo_url: "" }];

  const updateValue = (index: number, patch: Partial<EditableActorProfile>) => {
    const nextValues = [...visibleValues];
    nextValues[index] = { ...nextValues[index], ...patch };
    onChange(nextValues);
  };

  const removeValue = (index: number) => {
    onChange(visibleValues.filter((_, valueIndex) => valueIndex !== index));
  };

  return (
    <div className={FIELD_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <span className={LABEL_CLASS}>{t.nfo.editor.actorProfiles}</span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange([...values, { name: "", photo_url: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          {t.nfo.editor.add}
        </Button>
      </div>
      <div className="space-y-3">
        {visibleValues.map((profile, index) => (
          // Keyed by position: NFO actor profile rows have no persisted IDs and are edited in place.
          <div
            key={index}
            className="grid gap-3 rounded-quiet bg-surface-low/60 p-3 min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
          >
            <TextField
              label={t.nfo.editor.actorName}
              value={profile.name}
              disabled={disabled}
              onChange={(value) => updateValue(index, { name: value })}
            />
            <TextField
              label={t.nfo.editor.actorPhotoUrl}
              value={profile.photo_url}
              disabled={disabled}
              onChange={(value) => updateValue(index, { photo_url: value })}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={t.nfo.editor.deleteActorProfileAria(index + 1)}
              className="self-end"
              onClick={() => removeValue(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}

export function NfoEditorDialog({
  open,
  data,
  errors,
  dirty,
  saving,
  onOpenChange,
  onDataChange,
  onSave,
}: NfoEditorDialogProps) {
  const t = useT();
  const websiteSelectId = useId();
  const updateField = <Key extends keyof EditableNfoData>(key: Key, value: EditableNfoData[Key]) => {
    onDataChange((current) => ({ ...current, [key]: value }));
  };

  const updateTextField = (key: TextFieldKey) => (value: string) =>
    updateField(key, value as EditableNfoData[typeof key]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-5xl gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/50 px-6 py-5">
          <DialogTitle>{t.nfo.editor.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.nfo.editor.description}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(88vh-150px)]">
          <fieldset disabled={saving} className="space-y-6 px-6 py-5">
            <Section title={t.nfo.editor.sections.basic}>
              <div className="grid gap-4 min-[760px]:grid-cols-2">
                <TextField
                  label={t.nfo.editor.fields.title}
                  value={data.title}
                  error={errors.title}
                  onChange={updateTextField("title")}
                />
                <TextField
                  label={t.nfo.editor.fields.titleZh}
                  value={data.title_zh}
                  onChange={updateTextField("title_zh")}
                />
                <TextField
                  label={t.nfo.editor.fields.number}
                  value={data.number}
                  error={errors.number}
                  onChange={updateTextField("number")}
                />
                <div className={FIELD_CLASS}>
                  <label htmlFor={websiteSelectId} className={LABEL_CLASS}>
                    {t.nfo.editor.fields.sourceSite}
                  </label>
                  <Select
                    value={data.website}
                    disabled={saving}
                    onValueChange={(value) => updateField("website", value as Website)}
                  >
                    <SelectTrigger id={websiteSelectId} aria-invalid={Boolean(errors.website)}>
                      <SelectValue placeholder={t.nfo.editor.fields.selectSite} />
                    </SelectTrigger>
                    <SelectContent>
                      {WEBSITE_OPTIONS.map((website) => (
                        <SelectItem key={website} value={website}>
                          {website}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors.website} />
                </div>
                <TextField
                  label={t.nfo.editor.fields.releaseDate}
                  value={data.release_date}
                  onChange={updateTextField("release_date")}
                />
                <TextField
                  label={t.nfo.editor.fields.durationSeconds}
                  type="number"
                  value={data.durationSeconds}
                  error={errors.durationSeconds}
                  onChange={updateTextField("durationSeconds")}
                />
                <TextField
                  label={t.nfo.editor.fields.rating}
                  type="number"
                  value={data.rating}
                  error={errors.rating}
                  onChange={updateTextField("rating")}
                />
                <TextField
                  label={t.nfo.editor.fields.contentType}
                  value={data.content_type}
                  onChange={updateTextField("content_type")}
                />
              </div>
            </Section>

            <Section title={t.nfo.editor.sections.production}>
              <div className="grid gap-4 min-[760px]:grid-cols-2">
                <TextField
                  label={t.nfo.editor.fields.studio}
                  value={data.studio}
                  onChange={updateTextField("studio")}
                />
                <TextField
                  label={t.nfo.editor.fields.director}
                  value={data.director}
                  onChange={updateTextField("director")}
                />
                <TextField
                  label={t.nfo.editor.fields.publisher}
                  value={data.publisher}
                  onChange={updateTextField("publisher")}
                />
                <TextField
                  label={t.nfo.editor.fields.series}
                  value={data.series}
                  onChange={updateTextField("series")}
                />
              </div>
            </Section>

            <Section title={t.nfo.editor.sections.text}>
              <div className="grid gap-4 min-[760px]:grid-cols-2">
                <TextareaField label={t.nfo.editor.fields.plot} value={data.plot} onChange={updateTextField("plot")} />
                <TextareaField
                  label={t.nfo.editor.fields.plotZh}
                  value={data.plot_zh}
                  onChange={updateTextField("plot_zh")}
                />
              </div>
            </Section>

            <Section title={t.nfo.editor.sections.people}>
              <div className="grid gap-5 min-[760px]:grid-cols-2">
                <StringListField
                  label={t.nfo.editor.fields.actors}
                  values={data.actors}
                  onChange={(values) => updateField("actors", values)}
                />
                <StringListField
                  label={t.nfo.editor.fields.tags}
                  values={data.genres}
                  onChange={(values) => updateField("genres", values)}
                />
              </div>
              <ActorProfilesField
                values={data.actor_profiles}
                error={errors.actor_profiles}
                onChange={(values) => updateField("actor_profiles", values)}
              />
            </Section>

            <Section title={t.nfo.editor.sections.images}>
              <div className="grid gap-4 min-[760px]:grid-cols-3">
                <TextField
                  label={t.nfo.editor.fields.thumbUrl}
                  value={data.thumb_url}
                  onChange={updateTextField("thumb_url")}
                />
                <TextField
                  label={t.nfo.editor.fields.posterUrl}
                  value={data.poster_url}
                  onChange={updateTextField("poster_url")}
                />
                <TextField
                  label={t.nfo.editor.fields.fanartUrl}
                  value={data.fanart_url}
                  onChange={updateTextField("fanart_url")}
                />
              </div>
            </Section>

            <Section title={t.nfo.editor.sections.sources}>
              <div className="grid gap-4 min-[760px]:grid-cols-2">
                <TextField
                  label={t.nfo.editor.fields.thumbSourceUrl}
                  value={data.thumb_source_url}
                  onChange={updateTextField("thumb_source_url")}
                />
                <TextField
                  label={t.nfo.editor.fields.posterSourceUrl}
                  value={data.poster_source_url}
                  onChange={updateTextField("poster_source_url")}
                />
                <TextField
                  label={t.nfo.editor.fields.fanartSourceUrl}
                  value={data.fanart_source_url}
                  onChange={updateTextField("fanart_source_url")}
                />
                <TextField
                  label={t.nfo.editor.fields.trailerSourceUrl}
                  value={data.trailer_source_url}
                  onChange={updateTextField("trailer_source_url")}
                />
              </div>
            </Section>

            <Section title={t.nfo.editor.sections.media}>
              <div className="grid gap-5 min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <TextField
                  label={t.nfo.editor.fields.trailerUrl}
                  value={data.trailer_url}
                  onChange={updateTextField("trailer_url")}
                />
                <StringListField
                  label={t.nfo.editor.fields.stills}
                  values={data.scene_images}
                  onChange={(values) => updateField("scene_images", values)}
                />
              </div>
            </Section>
          </fieldset>
        </ScrollArea>

        <DialogFooter className="border-t border-border/50 px-6 py-4">
          <div className="mr-auto self-center text-xs text-muted-foreground">
            {dirty ? t.nfo.editor.unsavedChanges : t.nfo.editor.unmodified}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? t.nfo.editor.saving : t.nfo.editor.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
