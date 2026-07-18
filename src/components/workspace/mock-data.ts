export type VideoFormat = "MP4" | "MKV" | "MOV" | "WEBM" | "AVI";

export type AudioFormat =
  | "MP3"
  | "M4A"
  | "AAC"
  | "FLAC"
  | "WAV"
  | "OGG"
  | "OPUS"
  | "WMA";

export type MediaFormat = VideoFormat | AudioFormat;

export type MediaNode = {
  id: string;
  name: string;
  format: MediaFormat;
  path: string;
};
