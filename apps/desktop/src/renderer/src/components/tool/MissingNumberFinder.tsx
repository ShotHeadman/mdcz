import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_INPUT_CLASS,
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
  TOOL_TABLE_SHELL_CLASS,
  TOOL_TEXTAREA_CLASS,
} from "./toolStyles";

interface MissingResultRow {
  index: number;
  number: string;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRangeInput(text: string): { start: number; end: number; width: number } | null {
  const match = text.trim().match(/^(\d+)\s*[-~—到]+\s*(\d+)$/u);
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 || start > end) {
    return null;
  }

  return { start, end, width: Math.max(startRaw.length, endRaw.length, 3) };
}

export function MissingNumberFinder() {
  const { showError, showInfo, showSuccess } = useToast();
  const [missingPrefix, setMissingPrefix] = useState("");
  const [missingRange, setMissingRange] = useState("");
  const [existingNumbers, setExistingNumbers] = useState("");
  const [missingRows, setMissingRows] = useState<MissingResultRow[]>([]);
  const [missingSummary, setMissingSummary] = useState("");
  const missingPreviewRows = missingRows.slice(0, 300);

  const handleFindMissing = () => {
    const prefix = missingPrefix.trim().toUpperCase();
    if (!prefix) {
      showError("请输入番号前缀");
      return;
    }

    const range = parseRangeInput(missingRange);
    if (!range) {
      showError("请输入有效范围，例如 1-200 或 001-120");
      return;
    }
    if (range.end - range.start > 20000) {
      showError("范围过大，请缩小后再查询");
      return;
    }

    const matchedNumbers = new Set<number>();
    const numberPattern = new RegExp(`${escapeRegExp(prefix)}[-_\\s]?(\\d+)`, "giu");
    for (const match of existingNumbers.toUpperCase().matchAll(numberPattern)) {
      const num = Number(match[1]);
      if (Number.isInteger(num)) {
        matchedNumbers.add(num);
      }
    }
    if (matchedNumbers.size === 0) {
      for (const raw of existingNumbers.match(/\d+/g) ?? []) {
        const num = Number(raw);
        if (Number.isInteger(num)) {
          matchedNumbers.add(num);
        }
      }
    }

    const rows: MissingResultRow[] = [];
    for (let number = range.start; number <= range.end; number += 1) {
      if (!matchedNumbers.has(number)) {
        rows.push({
          index: rows.length + 1,
          number: `${prefix}-${String(number).padStart(range.width, "0")}`,
        });
      }
    }

    const expectedTotal = range.end - range.start + 1;
    setMissingRows(rows);
    setMissingSummary(
      `范围 ${range.start}-${range.end}，期望 ${expectedTotal}，已识别 ${matchedNumbers.size}，缺失 ${rows.length}`,
    );
    if (rows.length === 0) {
      showSuccess("未发现缺失番号");
    } else {
      showInfo(`查找完成，缺失 ${rows.length} 条`);
    }
  };

  return (
    <ToolPanel toolId="missing-number-finder" icon={<Search className="h-5 w-5" />}>
      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label
              htmlFor="missing-prefix"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              番号前缀
            </Label>
            <Input
              id="missing-prefix"
              placeholder="例如: ABC"
              value={missingPrefix}
              onChange={(event) => setMissingPrefix(event.target.value)}
              className={TOOL_INPUT_CLASS}
            />
          </div>

          <div className="grid gap-2">
            <Label
              htmlFor="missing-range"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              数字范围
            </Label>
            <Input
              id="missing-range"
              placeholder="例如: 1-120"
              value={missingRange}
              onChange={(event) => setMissingRange(event.target.value)}
              className={TOOL_INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label
            htmlFor="existing-numbers"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            已存在番号列表
          </Label>
          <Textarea
            id="existing-numbers"
            value={existingNumbers}
            onChange={(event) => setExistingNumbers(event.target.value)}
            placeholder="ABC-001, ABC-002, ABC-004..."
            className={cn(TOOL_TEXTAREA_CLASS, "min-h-[160px] text-sm")}
          />
        </div>
      </div>

      <Button
        variant="secondary"
        onClick={handleFindMissing}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        开始查找缺失番号
      </Button>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            查找结果
          </Label>
          {missingSummary ? (
            <span className="font-numeric text-xs font-semibold text-foreground">{missingSummary}</span>
          ) : null}
        </div>

        <div className={TOOL_TABLE_SHELL_CLASS}>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-low/90 text-muted-foreground">
                <th className="w-16 px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">序号</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.16em]">建议番号</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {missingPreviewRows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-12 text-center text-muted-foreground italic">
                    无查找结果
                  </td>
                </tr>
              ) : (
                missingPreviewRows.map((row) => (
                  <tr key={row.number} className="transition-colors hover:bg-surface-low/45">
                    <td className="px-4 py-3 font-numeric text-muted-foreground">{row.index}</td>
                    <td className="px-4 py-3 font-mono font-medium">{row.number}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ToolPanel>
  );
}
