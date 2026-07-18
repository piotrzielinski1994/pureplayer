import type { MediaFormat, MediaNode } from "@/components/workspace/mock-data";

const EXTENSION_FORMAT: Record<string, MediaFormat> = {
  mp4: "MP4",
  mkv: "MKV",
  mov: "MOV",
  webm: "WEBM",
  avi: "AVI",
  mp3: "MP3",
  m4a: "M4A",
  aac: "AAC",
  flac: "FLAC",
  wav: "WAV",
  ogg: "OGG",
  opus: "OPUS",
  wma: "WMA",
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function formatOf(name: string): MediaFormat {
  const extension = name.includes(".")
    ? (name.split(".").pop()?.toLowerCase() ?? "")
    : "";
  return EXTENSION_FORMAT[extension] ?? "MP4";
}

export function mediaFromPaths(paths: readonly string[]): MediaNode[] {
  return paths.map((path) => {
    const name = basename(path);
    return { id: path, name, format: formatOf(name), path };
  });
}
