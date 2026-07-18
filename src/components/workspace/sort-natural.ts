import type { MediaNode } from "@/components/workspace/mock-data";

export type SortField = "title" | "type";

function numericPrefix(name: string): number | null {
  const match = name.match(/^\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function compareTitle(a: MediaNode, b: MediaNode): number {
  const prefixA = numericPrefix(a.name);
  const prefixB = numericPrefix(b.name);
  if (prefixA !== null && prefixB !== null && prefixA !== prefixB) {
    return prefixA - prefixB;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

const FIELD_COMPARATORS: Record<
  SortField,
  (a: MediaNode, b: MediaNode) => number
> = {
  title: compareTitle,
  type: (a, b) => a.format.localeCompare(b.format),
};

export function sortMedia(
  media: MediaNode[],
  keys: SortField[],
  direction: "asc" | "desc",
): MediaNode[] {
  if (keys.length === 0) {
    return [...media];
  }
  const sign = direction === "desc" ? -1 : 1;
  return [...media].sort((a, b) => {
    for (const key of keys) {
      const result = FIELD_COMPARATORS[key](a, b);
      if (result !== 0) {
        return result * sign;
      }
    }
    return 0;
  });
}
