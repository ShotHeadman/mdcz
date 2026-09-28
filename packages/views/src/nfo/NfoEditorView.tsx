import type { CrawlerDataDto } from "@mdcz/shared";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea } from "@mdcz/ui";
import { FileText } from "lucide-react";
import { useT } from "../i18n";

export interface NfoEditorViewProps {
  data: CrawlerDataDto;
  errorMessage?: string | null;
  nfoRelativePath?: string | null;
  saveDisabled?: boolean;
  onArrayFieldChange: (field: "actors" | "genres", value: string[]) => void;
  onFieldChange: (field: NfoStringField, value: string) => void;
  onSave: () => void;
}

export type NfoStringField = "title" | "title_zh" | "number" | "release_date" | "studio" | "director" | "plot";

const parseLines = (value: string): string[] =>
  value
    .split(/[\n,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);

export function NfoEditorView({
  data,
  errorMessage,
  nfoRelativePath,
  saveDisabled = false,
  onArrayFieldChange,
  onFieldChange,
  onSave,
}: NfoEditorViewProps) {
  const t = useT();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.nfo.view.cardTitle}</CardTitle>
        <CardDescription>{nfoRelativePath ?? t.nfo.view.nfoDefaultPath}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <NfoField
          label={t.nfo.editor.fields.title}
          value={data.title}
          onChange={(value) => onFieldChange("title", value)}
        />
        <NfoField
          label={t.nfo.editor.fields.titleZh}
          value={data.title_zh ?? ""}
          onChange={(value) => onFieldChange("title_zh", value)}
        />
        <NfoField
          label={t.nfo.editor.fields.number}
          value={data.number}
          onChange={(value) => onFieldChange("number", value)}
        />
        <NfoField
          label={t.nfo.editor.fields.releaseDate}
          value={data.release_date ?? ""}
          onChange={(value) => onFieldChange("release_date", value)}
        />
        <NfoField
          label={t.nfo.editor.fields.studio}
          value={data.studio ?? ""}
          onChange={(value) => onFieldChange("studio", value)}
        />
        <NfoField
          label={t.nfo.editor.fields.director}
          value={data.director ?? ""}
          onChange={(value) => onFieldChange("director", value)}
        />
        <div className="grid gap-2 lg:col-span-2">
          <Label>{t.nfo.editor.fields.actors}</Label>
          <Textarea
            value={data.actors.join("\n")}
            onChange={(event) => onArrayFieldChange("actors", parseLines(event.target.value))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>{t.nfo.editor.fields.tags}</Label>
          <Textarea
            value={data.genres.join("\n")}
            onChange={(event) => onArrayFieldChange("genres", parseLines(event.target.value))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>{t.nfo.editor.fields.plot}</Label>
          <Textarea value={data.plot ?? ""} onChange={(event) => onFieldChange("plot", event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <Button disabled={saveDisabled} onClick={onSave} type="button">
            <FileText className="h-4 w-4" />
            {t.nfo.view.saveNfo}
          </Button>
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function NfoField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
