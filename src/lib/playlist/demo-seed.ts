import type { MediaNode } from "@/components/workspace/mock-data";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";

// In-memory playlist for the `npm run dev` browser build. The dev-browser build
// seeds this so the playlist renders instead of the empty state (see
// `isDevBrowser`).
export function demoMedia(): MediaNode[] {
  return [
    {
      id: "m-bbb",
      name: "Big Buck Bunny",
      format: "MP4",
      path: "/demo/big-buck-bunny.mp4",
    },
    {
      id: "m-sintel",
      name: "Sintel Trailer",
      format: "MKV",
      path: "/demo/sintel-trailer.mkv",
    },
    {
      id: "m-jazz",
      name: "Jazz Loop",
      format: "MP3",
      path: "/demo/jazz-loop.mp3",
    },
  ];
}

export function demoSettings(): Settings {
  return { ...DEFAULT_SETTINGS, volume: 0.8 };
}
