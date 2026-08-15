import { cn, ScrollArea } from "@pziel/pureui";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLogLines } from "@/components/workspace/workspace-context";
import type { LogLevel, LogLine } from "@/lib/logging/log-line";
import {
  filterLogLines,
  type HighlightSegment,
  highlightLogSearch,
} from "@/lib/logging/log-search";

// The message text is ALWAYS muted grey regardless of level - only the level BADGE carries the
// signal color (see LEVEL_BADGE_CLASS), so an error is identified by its red badge alone, not a
// red-tinted line. The kv VALUES set their own text-foreground so they still stand out white.
const LEVEL_BADGE_CLASS: Record<LogLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
};

// One application-log line: muted timestamp, colored level badge, and the message with its
// key=value pairs dimmed keys + accented values. Falls back to the raw text when the line was
// unparseable (empty timestamp).
function LogLineRow({ line }: { line: LogLine }) {
  const parts = line.message.split(/(\s+)/);
  return (
    <li className="break-all py-0.5 text-muted-foreground">
      {line.timestamp ? (
        <span className="text-muted-foreground">{line.timestamp} </span>
      ) : null}
      <span className={cn("uppercase", LEVEL_BADGE_CLASS[line.level])}>
        {line.level}
      </span>{" "}
      {parts.map((part, index) => {
        const kv = part.match(/^([A-Za-z_]+)=(\S+)$/);
        if (!kv) {
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed split-order fragments of one message
          return <span key={index}>{part}</span>;
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed split-order fragments of one message
          <span key={index}>
            <span className={KV_KEY_CLASS}>{kv[1]}=</span>
            <span className={KV_VALUE_CLASS}>{kv[2]}</span>
          </span>
        );
      })}
    </li>
  );
}

// key=value coloring shared by the log lines + the search overlay: keys orange, values white
// (foreground), plain/bare text muted grey.
const KV_KEY_CLASS = "text-orange-600 dark:text-orange-400";
const KV_VALUE_CLASS = "text-foreground";

const SEARCH_SEGMENT_CLASS: Record<HighlightSegment["kind"], string> = {
  key: KV_KEY_CLASS,
  value: KV_VALUE_CLASS,
  plain: "text-muted-foreground",
};

// Shared box geometry for the search input + its highlight overlay - IDENTICAL padding/size/font on
// both so the tinted text sits exactly under the real (transparent-text) input. The border lives
// only on the input; the overlay is inset by the same 1px so text still aligns.
const SEARCH_BOX =
  "h-5 w-52 px-2 text-xs leading-5 whitespace-pre overflow-hidden";

// The Logs search field with live field-key coloring. A plain <input> can't tint substrings, so a
// mirrored highlight layer renders behind a transparent-text input (the input still owns the
// caret/selection/typing).
function LogSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const segments = highlightLogSearch(value);
  return (
    <div className="relative bg-background">
      <div
        aria-hidden="true"
        className={cn(
          SEARCH_BOX,
          "pointer-events-none absolute inset-0 flex items-center border border-transparent",
        )}
      >
        {segments.map((segment, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed split-order segments of one query
          <span key={index} className={SEARCH_SEGMENT_CLASS[segment.kind]}>
            {segment.text}
          </span>
        ))}
      </div>
      <input
        type="search"
        aria-label="Search logs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="level:error path:/tmp/x.mkv ..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          SEARCH_BOX,
          "relative border bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus:outline-none",
        )}
      />
    </div>
  );
}

export function LogsPanel() {
  const { logLines, clearLogLines } = useLogLines();
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => filterLogLines(logLines, search),
    [logLines, search],
  );
  // Stick the list to the bottom as new lines arrive (only while the panel is open).
  const logsEndRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (filtered.length === 0) {
      return;
    }
    logsEndRef.current?.scrollIntoView({ block: "end" });
  }, [filtered.length]);

  return (
    <section
      aria-label="Logs"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/30 font-mono text-xs"
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-2">
        <LogSearchInput value={search} onChange={setSearch} />
        <div className="ml-auto" />
        {logLines.length > 0 && (
          <button
            type="button"
            aria-label="Clear logs"
            title="Clear"
            onClick={clearLogLines}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {logLines.length === 0 ? (
          <p className="p-3 text-muted-foreground">
            No application logs yet this session.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-muted-foreground">No matching log lines.</p>
        ) : (
          <ul aria-label="Application logs" className="p-2">
            {filtered.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only log lines (no reorder)
              <LogLineRow key={index} line={line} />
            ))}
            <li ref={logsEndRef} aria-hidden="true" />
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}
