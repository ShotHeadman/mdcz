import { BRIEF_WORKFLOWS, type BriefWorkflow, briefCommand } from "@mdcz/shared/briefCatalog";
import type { LlmSettings } from "@mdcz/shared/config";
import { Command, CommandItem, CommandList, cn, quietFieldSurfaceClass } from "@mdcz/ui";
import { type KeyboardEvent, useRef, useState } from "react";
import { useT } from "../i18n";

/** A slash command and the text after it; text that names no workflow is a plain prompt. */
export const parsePrompt = (text: string): { workflow?: BriefWorkflow; rest: string } => {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(text.trim());
  const workflow = BRIEF_WORKFLOWS.find((candidate) => briefCommand(candidate) === match?.[1]);
  return workflow ? { workflow, rest: match?.[2]?.trim() ?? "" } : { rest: text.trim() };
};

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.userAgent);

const Hint = ({ keyLabel, label, onClick }: { keyLabel: string; label: string; onClick?: () => void }) => (
  <button
    type="button"
    tabIndex={onClick ? 0 : -1}
    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none"
    disabled={!onClick}
    onClick={onClick}
  >
    <kbd className="rounded-[4px] border border-border/70 px-1 font-numeric text-[10px] leading-4">{keyLabel}</kbd>
    {label}
  </button>
);

/**
 * The page's one input. While a draft is expanded the box belongs to it and a prompt changes that draft; Esc in the
 * empty box lets go of it, so the next prompt starts a job of its own. `sendKey` is the user's choice of Enter or
 * Ctrl/⌘+Enter to send; the other combination starts a new line.
 */
export function PromptBox({
  large = false,
  attached = false,
  sendKey,
  onSubmit,
  onDetach,
}: {
  large?: boolean;
  attached?: boolean;
  sendKey: LlmSettings["briefSendKey"];
  onSubmit: (text: string) => void;
  onDetach?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string>("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandQuery = /^\/(\S*)$/u.exec(text)?.[1];
  const commands =
    commandQuery === undefined
      ? []
      : BRIEF_WORKFLOWS.filter((workflow) => briefCommand(workflow).startsWith(commandQuery));
  const menuOpen = commands.length > 0;
  const active = commands.includes(selected as BriefWorkflow) ? selected : (commands[0] ?? "");

  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };
  const pick = (workflow: BriefWorkflow) => {
    setText(`/${briefCommand(workflow)} `);
    inputRef.current?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected(commands[(commands.indexOf(active as BriefWorkflow) + step + commands.length) % commands.length]);
      return;
    }
    if (menuOpen && (event.key === "Enter" || event.key === "Tab") && active) {
      event.preventDefault();
      pick(active as BriefWorkflow);
      return;
    }
    if (event.key === "Enter" && (sendKey === "enter" ? !event.shiftKey : event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape" && !text && attached) {
      event.preventDefault();
      onDetach?.();
    }
  };

  return (
    <div className="relative">
      {menuOpen ? (
        <Command
          value={active}
          onValueChange={setSelected}
          shouldFilter={false}
          className="absolute bottom-full left-0 z-10 mb-2 h-auto w-full max-w-md border border-border/60 shadow-md"
        >
          <CommandList>
            {commands.map((workflow) => (
              <CommandItem key={workflow} value={workflow} onSelect={() => pick(workflow)} className="items-baseline">
                <span className="font-mono text-xs">/{briefCommand(workflow)}</span>
                <span className="text-sm">{t.brief.workflows[workflow].title}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {t.brief.workflows[workflow].description}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      ) : null}
      <div
        className={cn(
          quietFieldSurfaceClass,
          "rounded-quiet px-4 pt-3 pb-2 transition-colors focus-within:border-ring/40 focus-within:ring-[3px] focus-within:ring-ring/15",
        )}
      >
        <textarea
          ref={inputRef}
          aria-label={t.brief.placeholder.docked}
          value={text}
          rows={large ? 3 : 1}
          placeholder={
            large ? t.brief.placeholder.empty : attached ? t.brief.placeholder.followUp : t.brief.placeholder.docked
          }
          className="field-sizing-content block max-h-48 min-h-6 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="mt-2 flex flex-wrap items-center justify-end gap-4">
          {attached ? <Hint keyLabel="esc" label={t.brief.hints.newJob} onClick={onDetach} /> : null}
          <Hint
            keyLabel="/"
            label={t.brief.hints.commands}
            onClick={() => {
              setText("/");
              inputRef.current?.focus();
            }}
          />
          <Hint
            keyLabel={sendKey === "enter" ? "↵" : `${MAC ? "⌘" : "Ctrl"} ↵`}
            label={t.brief.hints.send}
            onClick={text.trim() ? submit : undefined}
          />
        </div>
      </div>
    </div>
  );
}
