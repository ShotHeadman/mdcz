import { MissingNumberFinderDetail, type ToolRunState } from "@mdcz/views/tools";
import { useState } from "react";
import { useToast } from "@/contexts/ToastProvider";

export function MissingNumberFinder() {
  const { showInfo, showSuccess } = useToast();
  const [state, setState] = useState<ToolRunState | undefined>();

  return (
    <MissingNumberFinderDetail
      state={state}
      onRun={(input) => {
        const from = Number.isFinite(input.start) ? input.start : 0;
        const to = Number.isFinite(input.end) ? input.end : -1;
        const count = to >= from ? to - from + 1 : 0;
        const message = `查找完成，范围内共 ${count} 个编号，已输入 ${input.existing.length} 个已有编号。`;
        setState({ message, data: input });
        if (count === 0) {
          showInfo("请输入有效范围");
        } else {
          showSuccess(message);
        }
      }}
    />
  );
}
