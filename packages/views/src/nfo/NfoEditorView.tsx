import type { CrawlerDataDto } from "@mdcz/shared";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea } from "@mdcz/ui";
import { FileText } from "lucide-react";

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
  return (
    <Card>
      <CardHeader>
        <CardTitle>元数据与 NFO</CardTitle>
        <CardDescription>{nfoRelativePath ?? "刮削成功后生成 NFO 路径"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <NfoField label="标题" value={data.title} onChange={(value) => onFieldChange("title", value)} />
        <NfoField label="中文标题" value={data.title_zh ?? ""} onChange={(value) => onFieldChange("title_zh", value)} />
        <NfoField label="番号" value={data.number} onChange={(value) => onFieldChange("number", value)} />
        <NfoField
          label="发行日期"
          value={data.release_date ?? ""}
          onChange={(value) => onFieldChange("release_date", value)}
        />
        <NfoField label="制作商" value={data.studio ?? ""} onChange={(value) => onFieldChange("studio", value)} />
        <NfoField label="导演" value={data.director ?? ""} onChange={(value) => onFieldChange("director", value)} />
        <div className="grid gap-2 lg:col-span-2">
          <Label>演员</Label>
          <Textarea
            value={data.actors.join("\n")}
            onChange={(event) => onArrayFieldChange("actors", parseLines(event.target.value))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>类型</Label>
          <Textarea
            value={data.genres.join("\n")}
            onChange={(event) => onArrayFieldChange("genres", parseLines(event.target.value))}
          />
        </div>
        <div className="grid gap-2 lg:col-span-2">
          <Label>简介</Label>
          <Textarea value={data.plot ?? ""} onChange={(event) => onFieldChange("plot", event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">
          <Button disabled={saveDisabled} onClick={onSave} type="button">
            <FileText className="h-4 w-4" />
            保存 NFO
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
