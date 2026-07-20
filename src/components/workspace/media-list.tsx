import { cn } from "@/lib/utils";
import { FORMAT_COLOR } from "@/components/workspace/format-color";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { ScrollArea } from "@/components/ui/scroll-area";

export function MediaList() {
  const { playlist, selectedNodeId, selectNode } = useWorkspace();

  return (
    <ScrollArea className="min-h-0 flex-1" horizontal>
      <ul role="list" aria-label="Playlist">
        {playlist.map((media) => (
          <li
            key={media.id}
            role="listitem"
            aria-selected={selectedNodeId === media.id}
            aria-label={media.name}
            tabIndex={0}
            onClick={() => selectNode(media.id)}
            className={cn(
              "flex cursor-pointer items-center gap-2 px-3 py-1 text-[13px] hover:bg-accent",
              selectedNodeId === media.id ? "bg-accent" : "bg-background",
            )}
          >
            <span className="whitespace-nowrap">{media.name}</span>
            <span
              className={cn(
                "sticky right-0 -mr-3 ml-auto shrink-0 bg-inherit pr-3 pl-2 font-mono text-[11px] font-semibold",
                FORMAT_COLOR[media.format],
              )}
            >
              {media.format}
            </span>
          </li>
        ))}
      </ul>
      {playlist.length === 0 && (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          (no media)
        </p>
      )}
    </ScrollArea>
  );
}
