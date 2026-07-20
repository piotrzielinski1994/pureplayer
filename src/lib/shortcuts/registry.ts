export type ShortcutActionId =
  | "open-command-palette"
  | "open-settings"
  | "close-settings"
  | "open-files"
  | "toggle-play"
  | "next-media"
  | "prev-media"
  | "seek-forward"
  | "seek-back"
  | "seek-forward-fine"
  | "seek-back-fine"
  | "frame-step-forward"
  | "frame-step-back"
  | "volume-up"
  | "volume-down"
  | "toggle-mute"
  | "speed-up"
  | "speed-down"
  | "toggle-shuffle"
  | "cycle-repeat"
  | "toggle-sort-direction"
  | "toggle-sidebar"
  | "toggle-transport"
  | "toggle-mini-player"
  | "toggle-fullscreen"
  | "toggle-reveal-transport"
  | "rotate-cw"
  | "cycle-fit-mode"
  | "zoom-in"
  | "zoom-out"
  | "reset-viewport";

export type ShortcutAction = {
  id: ShortcutActionId;
  name: string;
  description: string;
  defaultHotkey: string;
  keywords?: string[];
};

export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  {
    id: "open-command-palette",
    name: "Open command palette",
    description: "Search and run any action from a command list.",
    defaultHotkey: "Mod+K",
  },
  {
    id: "open-settings",
    name: "Open settings",
    description: "Go to the settings page.",
    defaultHotkey: "Mod+,",
  },
  {
    id: "close-settings",
    name: "Back to workspace",
    description: "Leave settings and return to the workspace.",
    defaultHotkey: "Escape",
  },
  {
    id: "open-files",
    name: "Open files",
    description: "Open media files and load them into the playlist.",
    defaultHotkey: "Mod+O",
  },
  {
    id: "toggle-play",
    name: "Play / pause",
    description: "Toggle playback of the active media.",
    defaultHotkey: "Space",
  },
  {
    id: "next-media",
    name: "Next media",
    description: "Activate the next item in the current order.",
    defaultHotkey: "Mod+Right",
  },
  {
    id: "prev-media",
    name: "Previous media",
    description: "Activate the previous item in the current order.",
    defaultHotkey: "Mod+Left",
  },
  {
    id: "seek-forward",
    name: "Seek forward 5s",
    description: "Jump the active media forward by 5 seconds.",
    defaultHotkey: "ArrowRight",
  },
  {
    id: "seek-back",
    name: "Seek back 5s",
    description: "Jump the active media back by 5 seconds.",
    defaultHotkey: "ArrowLeft",
  },
  {
    id: "seek-forward-fine",
    name: "Seek forward 1s",
    description: "Jump the active media forward by 1 second.",
    defaultHotkey: "Shift+ArrowRight",
  },
  {
    id: "seek-back-fine",
    name: "Seek back 1s",
    description: "Jump the active media back by 1 second.",
    defaultHotkey: "Shift+ArrowLeft",
  },
  {
    id: "frame-step-forward",
    name: "Frame step forward",
    description: "Pause and advance the active media by one frame (1/30s).",
    defaultHotkey: ".",
    keywords: ["frame", "step", "advance", "next frame"],
  },
  {
    id: "frame-step-back",
    name: "Frame step back",
    description: "Pause and step the active media back by one frame (1/30s).",
    defaultHotkey: ",",
    keywords: ["frame", "step", "previous frame"],
  },
  {
    id: "volume-up",
    name: "Volume up",
    description: "Raise playback volume by 5%.",
    defaultHotkey: "ArrowUp",
  },
  {
    id: "volume-down",
    name: "Volume down",
    description: "Lower playback volume by 5%.",
    defaultHotkey: "ArrowDown",
  },
  {
    id: "toggle-mute",
    name: "Mute / unmute",
    description: "Toggle mute on the active media.",
    defaultHotkey: "M",
  },
  {
    id: "speed-up",
    name: "Speed up",
    description: "Increase playback speed by 0.1x (up to 2x).",
    defaultHotkey: "]",
  },
  {
    id: "speed-down",
    name: "Speed down",
    description: "Decrease playback speed by 0.1x (down to 0.5x).",
    defaultHotkey: "[",
  },
  {
    id: "toggle-shuffle",
    name: "Toggle shuffle",
    description: "Shuffle the play order for next/prev and auto-advance.",
    defaultHotkey: "S",
  },
  {
    id: "cycle-repeat",
    name: "Cycle repeat",
    description: "Cycle repeat mode: off, all, then one.",
    defaultHotkey: "R",
  },
  {
    id: "toggle-sort-direction",
    name: "Toggle sort direction",
    description: "Flip the playlist between ascending and descending order.",
    defaultHotkey: "Mod+Shift+S",
  },
  {
    id: "toggle-sidebar",
    name: "Toggle sidebar",
    description: "Show or hide the playlist sidebar.",
    defaultHotkey: "Mod+B",
    keywords: ["playlist", "panel"],
  },
  {
    id: "toggle-transport",
    name: "Toggle transport bar",
    description: "Show or hide the transport bar.",
    defaultHotkey: "Mod+J",
    keywords: ["bottom bar", "controls", "playback bar"],
  },
  {
    id: "toggle-mini-player",
    name: "Toggle mini player",
    description:
      "Hide the content viewport and shrink the window to the sidebar and transport bar (mini player), or restore it. Toggle the sidebar too for a bar-only mini.",
    defaultHotkey: "Mod+Shift+M",
    keywords: ["mini", "compact", "bottom bar", "shrink", "minimize", "tiny", "playlist"],
  },
  {
    id: "toggle-fullscreen",
    name: "Toggle fullscreen",
    description: "Enter or leave fullscreen playback.",
    defaultHotkey: "Mod+Shift+F",
    keywords: ["full screen", "immersive"],
  },
  {
    id: "toggle-reveal-transport",
    name: "Toggle reveal transport on hover",
    description:
      "When the transport bar is hidden, show it while the mouse is over the video.",
    defaultHotkey: "Mod+Shift+H",
    keywords: ["bottom bar", "hover", "auto show", "auto hide"],
  },
  {
    id: "rotate-cw",
    name: "Rotate clockwise",
    description: "Rotate the video 90 degrees clockwise (cycles back to 0).",
    defaultHotkey: "Mod+Shift+R",
    keywords: ["rotate", "turn", "orientation", "sideways"],
  },
  {
    id: "cycle-fit-mode",
    name: "Cycle fit mode",
    description: "Cycle how the video fits its frame: contain, cover, then fill.",
    defaultHotkey: "F",
    keywords: ["fit", "aspect", "contain", "cover", "fill", "crop", "stretch"],
  },
  {
    id: "zoom-in",
    name: "Zoom in",
    description: "Zoom into the video by 10% (up to 4x).",
    defaultHotkey: "=",
    keywords: ["zoom", "magnify", "scale"],
  },
  {
    id: "zoom-out",
    name: "Zoom out",
    description: "Zoom out of the video by 10% (down to 1x).",
    defaultHotkey: "-",
    keywords: ["zoom", "scale"],
  },
  {
    id: "reset-viewport",
    name: "Reset viewport",
    description: "Reset rotation, fit mode and zoom to defaults.",
    defaultHotkey: "Mod+0",
    keywords: ["reset", "transform", "rotate", "zoom", "fit"],
  },
];
