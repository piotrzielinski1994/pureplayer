use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{async_runtime, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::hls_server;

#[derive(Serialize)]
pub struct PreparedMedia {
    pub path: String,
    pub transcoded: bool,
    // Real source duration (seconds), so the FE can show it while an HLS stream's
    // own duration is still Infinity. None when ffprobe didn't report one.
    #[serde(rename = "durationSec")]
    pub duration_sec: Option<f64>,
    // Set on the two-phase (video-then-audio) path: the FE plays the silent video
    // immediately and, when the background AAC re-encode finishes, an
    // `media://audio-ready` event carrying this id delivers the full-audio file to
    // swap in. None for every other path (the file is already complete).
    #[serde(rename = "swapId")]
    pub swap_id: Option<u64>,
}

// Payload of the `media://audio-ready` event: which prepared source it belongs to
// (swap_id) and the complete file (with audio) to swap the <video> src to.
#[derive(Clone, Serialize)]
struct AudioReadyPayload {
    #[serde(rename = "swapId")]
    swap_id: u64,
    path: String,
}

// A running HLS encode: the ffmpeg child (kept alive past prepare_media so it
// streams ahead of playback) plus the segment dir, so the next activation can
// kill and clean it.
pub struct HlsJob {
    pub dir: PathBuf,
    pub child: CommandChild,
    // What the encode was started with, so a seek past the written segments can
    // restart it at the target position without probing the file again.
    pub source: String,
    pub video: VideoAction,
    pub audio: AudioAction,
    pub channels: Option<u32>,
    pub duration_sec: Option<f64>,
}

// A background audio re-encode for the two-phase (video-then-audio) path: the
// ffmpeg child writing the full file, the output path (to remove on cancel), and
// the original source path so a stale completion can be matched/ignored.
pub struct BgJob {
    pub source: String,
    pub child: CommandChild,
    pub out: PathBuf,
}

// App-lifetime media state: the HLS temp root the loopback server serves (rare
// re-encode path) plus its port, the remux root where complete MP4s are written
// (the common copy path), the open handles the passthrough source is served from,
// and the single in-flight job of each kind - only one video plays at a time.
pub struct MediaState {
    pub hls_root: PathBuf,
    pub remux_root: PathBuf,
    pub port: u16,
    pub files: hls_server::HeldFiles,
    pub current_hls: Mutex<Option<HlsJob>>,
    pub current_bg: Mutex<Option<BgJob>>,
}

// How long to wait for ffmpeg's first HLS segment before giving up. The encoder
// runs far faster than realtime, so the first segment normally lands in well
// under a second; this is a generous ceiling for pathological inputs.
const FIRST_SEGMENT_TIMEOUT: Duration = Duration::from_secs(20);

fn next_job_id() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum VideoAction {
    Copy,
    Reencode,
    None,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum AudioAction {
    Copy,
    Reencode,
    Drop,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum MediaPlan {
    Passthrough,
    Convert {
        video: VideoAction,
        audio: AudioAction,
    },
}

// How prepare_media will actually produce a webview source. Derived from the plan:
// when the video stream can be copied (h264), we always build a COMPLETE file on
// disk so `<video>` gets a finite duration and native random-access seeking - the
// HLS progressive stream (seekable.end == Infinity mid-encode) was the seek bug.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum MediaStrategy {
    // Video is copied or dropped and audio is already fine (or re-encoded to a
    // supported codec): one fast remux to a complete MP4. For an audio-only file
    // the video action is None (the absent/cover-art track is dropped with -vn),
    // so a music file plays and seeks natively with no HLS.
    CompleteRemux {
        video: VideoAction,
        audio: AudioAction,
    },
    // Video copies but audio needs re-encoding (Opus/AC3/...): emit a video-only
    // MP4 instantly (perfect seek, no sound), then re-encode audio in the
    // background and swap to the full file when it's ready.
    VideoThenAudio,
    // Video itself must be re-encoded (HEVC/VP9/AV1/...): no instant copy is
    // possible, so the picture is streamed as it encodes. macOS plays the HLS
    // playlist natively; Chromium webviews (WebView2/WebKitGTK) have no native
    // HLS, so the FE drives the same playlist with hls.js over MSE. Never route a
    // video re-encode to CompleteRemux: that blocks on encoding the ENTIRE film
    // before the first frame (a 3h40 4K HEVC source is hours of "Preparing").
    HlsStream { video: VideoAction, audio: AudioAction },
}

// Pure platform-aware plan: on Chromium a native WebM needs no work at all;
// everything else defers to `plan_media`.
fn plan_media_for_webview(
    container: &str,
    vcodec: &str,
    acodec: &str,
    is_webm_file: bool,
    chromium_like: bool,
) -> MediaPlan {
    // Chromium (WebView2, WebKitGTK) decodes VP8/VP9/AV1 + Opus/Vorbis in a WebM
    // file natively; WKWebView cannot play file-based WebM at all. Only the real
    // .webm extension qualifies: ffprobe reports "matroska,webm" for full .mkv
    // files too, and Chromium does not demux those.
    if chromium_like
        && is_webm_file
        && container.contains("webm")
        && matches!(vcodec, "vp8" | "vp9" | "av1")
        && matches!(acodec, "" | "opus" | "vorbis")
    {
        return MediaPlan::Passthrough;
    }
    plan_media(container, vcodec, acodec)
}

// Pure mapping plan -> strategy. Passthrough (already a complete playable file)
// has no strategy. The branch order matters: an audio-only file (no video track)
// always goes to a single complete remux (no picture to decode-ahead, so HLS never
// earns its keep); a copyable video beats HLS; only a copyable video with bad audio
// takes the two-phase path.
fn strategy_for(plan: MediaPlan) -> Option<MediaStrategy> {
    match plan {
        MediaPlan::Passthrough => None,
        MediaPlan::Convert {
            video: VideoAction::None,
            audio,
        } => Some(MediaStrategy::CompleteRemux {
            video: VideoAction::None,
            audio,
        }),
        MediaPlan::Convert {
            video: VideoAction::Copy,
            audio: AudioAction::Reencode,
        } => Some(MediaStrategy::VideoThenAudio),
        MediaPlan::Convert {
            video: VideoAction::Copy,
            audio,
        } => Some(MediaStrategy::CompleteRemux {
            video: VideoAction::Copy,
            audio,
        }),
        MediaPlan::Convert { video, audio } => Some(MediaStrategy::HlsStream { video, audio }),
    }
}

// A webview-playable audio-only file: a native codec in a native container, served
// untouched. Non-native (opus/vorbis/wma, or a native codec in an odd container)
// is remuxed/re-encoded to AAC-in-MP4 instead.
fn is_native_audio(container: &str, acodec: &str) -> bool {
    let is_native_codec = matches!(acodec, "aac" | "mp3" | "flac") || acodec.starts_with("pcm");
    let is_native_container = ["mp4", "mov", "mp3", "flac", "wav"]
        .iter()
        .any(|c| container.contains(c));
    is_native_codec && is_native_container
}

// Whether prepare_media can play the file at all: it needs at least one stream.
// A file with neither an audio nor a video stream (corrupt/empty) is unplayable.
fn has_playable_stream(vcodec: &str, acodec: &str) -> bool {
    !(vcodec.is_empty() && acodec.is_empty())
}

// Pure decision: given the container (ffprobe format_name), video codec and audio
// codec (a:"" = no audio, v:"" = no video / audio-only), decide what the webview
// needs. An audio-only file is served untouched when native, else remuxed to a
// complete AAC-in-MP4 with the video track dropped. Otherwise MP4-family + h264 +
// webview-playable audio is served untouched; anything else copies the streams that
// are already fine and re-encodes only those that are not.
fn plan_media(container: &str, vcodec: &str, acodec: &str) -> MediaPlan {
    let audio = match acodec {
        "" => AudioAction::Drop,
        "aac" | "mp3" => AudioAction::Copy,
        _ => AudioAction::Reencode,
    };
    if vcodec.is_empty() {
        if is_native_audio(container, acodec) {
            return MediaPlan::Passthrough;
        }
        return MediaPlan::Convert {
            video: VideoAction::None,
            audio,
        };
    }
    let video = if vcodec == "h264" {
        VideoAction::Copy
    } else {
        VideoAction::Reencode
    };
    let is_mp4_container = container.contains("mp4");
    let is_webview_ready = video == VideoAction::Copy && audio != AudioAction::Reencode;
    if is_mp4_container && is_webview_ready {
        return MediaPlan::Passthrough;
    }
    MediaPlan::Convert { video, audio }
}

#[derive(Debug, PartialEq)]
pub struct ProbeResult {
    pub container: String,
    pub vcodec: String,
    pub acodec: String,
    // Total source duration in seconds. HLS EVENT playlists don't declare a total
    // length until the encode ends, so `<video>.duration` reads Infinity mid-stream
    // - we carry the real duration through to the FE. None if ffprobe omits it.
    pub duration_sec: Option<f64>,
    // Channel count of the first audio stream. Only the HLS path needs it: ADTS
    // (AAC in MPEG-TS) cannot carry more than 7 channels.
    pub channels: Option<u32>,
}

// Pure parser of one `ffprobe -of json` payload: container = format.format_name,
// vcodec = first video stream's codec_name, acodec = first audio stream's,
// duration = format.duration (a string of seconds). A missing stream leaves its
// field "" (no video -> caller errors; no audio -> Drop). Junk/empty input parses
// to an all-empty result rather than panicking.
fn parse_probe_json(json: &str) -> ProbeResult {
    let root: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
    let container = root["format"]["format_name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let duration_sec = root["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok());
    // A cover-art picture (mp3/flac album art) is carried as a still-image "video"
    // stream with disposition.attached_pic == 1. It is not a motion-video track, so
    // skip it when reading the video codec - otherwise an audio file with art reads
    // as a non-h264 video and gets HLS-transcoded as a nonexistent video.
    let is_attached_pic = |stream: &serde_json::Value| {
        stream["disposition"]["attached_pic"].as_i64() == Some(1)
    };
    let codec_for = |kind: &str, skip_attached_pic: bool| {
        root["streams"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|s| {
                s["codec_type"].as_str() == Some(kind) && !(skip_attached_pic && is_attached_pic(s))
            })
            .and_then(|s| s["codec_name"].as_str())
            .unwrap_or("")
            .to_string()
    };
    let channels = root["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|s| s["codec_type"].as_str() == Some("audio"))
        .and_then(|s| s["channels"].as_u64())
        .map(|channels| channels as u32);
    ProbeResult {
        container,
        vcodec: codec_for("video", true),
        acodec: codec_for("audio", false),
        duration_sec,
        channels,
    }
}

// One ffprobe spawn yields container + both codecs (replaces three sequential
// spawns; each Tauri sidecar spawn carries ~500ms overhead). A failed spawn or
// non-JSON output parses to an all-empty result.
async fn probe_media(app: &tauri::AppHandle, path: &str) -> ProbeResult {
    let command = match app.shell().sidecar("ffprobe") {
        Ok(command) => command,
        Err(_) => return parse_probe_json(""),
    };
    let output = command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration:stream=codec_name,codec_type,channels",
            "-of",
            "json",
            path,
        ])
        .output()
        .await;
    match output {
        Ok(out) => parse_probe_json(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => parse_probe_json(""),
    }
}

// Pay the first-spawn cost of the bundled sidecars at startup, not on the user's
// first drop. The binaries are ~60MB Developer-ID-signed Mach-Os; macOS runs a
// one-time Gatekeeper check + pages them in on first exec, which otherwise lands
// as ~2-3s of latency on the first prepare_media. A trivial `-version` run warms
// the OS caches. Best-effort: errors are ignored.
#[cfg(not(windows))]
pub fn prewarm_sidecars(app: &tauri::AppHandle) {
    for binary in ["ffprobe", "ffmpeg"] {
        let Ok(command) = app.shell().sidecar(binary) else {
            continue;
        };
        async_runtime::spawn(async move {
            let _ = command.arg("-version").output().await;
        });
    }
}

// The bundled LGPL ffmpeg is built with --disable-libx264 (x264 is GPL), so the
// software H.264 encoder is libopenh264 - several times slower than realtime on a
// 4K source (measured: 10s of 4K HEVC -> 8.4s), which is why it is the last resort.
const SOFTWARE_VIDEO_ENCODER: &str = "libopenh264";

fn video_convert_args(action: VideoAction) -> Vec<&'static str> {
    match action {
        VideoAction::None => vec!["-vn"],
        VideoAction::Copy => vec!["-c:v", "copy"],
        VideoAction::Reencode => video_encode_args(default_video_encoder()),
    }
}

// macOS ships a platform encoder that is always there. Elsewhere prefer hardware,
// in rough order of how many machines have it: NVENC, QuickSync, AMF, then the
// vendor-agnostic MediaFoundation encoder, then software. A name the bundled ffmpeg
// cannot initialise fails fast (a few ms), so probing is cheap.
fn video_encoder_candidates() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        return &["h264_videotoolbox"];
    }
    &["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", SOFTWARE_VIDEO_ENCODER]
}

// The platform's always-available encoder: what a re-encode falls back to when no
// hardware encoder was selected.
fn default_video_encoder() -> &'static str {
    if cfg!(target_os = "macos") {
        return "h264_videotoolbox";
    }
    SOFTWARE_VIDEO_ENCODER
}

// Encoder args for a picture re-encode. Sources are routinely 10-bit (HEVC/AV1),
// which the 8-bit H.264 encoders here cannot take, so pin the 8-bit format. Only
// pinned off macOS: VideoToolbox handles 10-bit/HDR itself, and forcing it there
// would throw that away for no gain.
fn video_encode_args(encoder: &'static str) -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        return vec!["-c:v", encoder, "-b:v", "6M"];
    }
    vec!["-c:v", encoder, "-b:v", "6M", "-pix_fmt", "yuv420p"]
}

// Whether this machine can actually encode with `encoder`. A 0.2s null encode
// exercises real hardware initialisation, which a mere `ffmpeg -encoders` listing
// does not: the binary lists NVENC/QuickSync/AMF regardless of the GPU present.
async fn encoder_available(app: &tauri::AppHandle, encoder: &str) -> bool {
    let Ok(command) = app.shell().sidecar("ffmpeg") else {
        return false;
    };
    let output = command
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x240:d=0.2",
            "-c:v",
            encoder,
            "-pix_fmt",
            "yuv420p",
            "-f",
            "null",
            "-",
        ])
        .output()
        .await;
    matches!(output, Ok(out) if out.status.code() == Some(0))
}

// First encoder this machine really has, resolved once per app run: probing costs
// a spawn per candidate and the answer cannot change while the app runs.
async fn select_video_encoder(app: &tauri::AppHandle) -> &'static str {
    static SELECTED: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();
    if let Some(encoder) = SELECTED.get() {
        return encoder;
    }
    // macOS's encoder is part of the platform, not the hardware: no probe needed.
    if cfg!(target_os = "macos") {
        let _ = SELECTED.set(default_video_encoder());
        return default_video_encoder();
    }
    for candidate in video_encoder_candidates() {
        if encoder_available(app, candidate).await {
            let _ = SELECTED.set(candidate);
            return candidate;
        }
    }
    let _ = SELECTED.set(SOFTWARE_VIDEO_ENCODER);
    SOFTWARE_VIDEO_ENCODER
}

// HLS output format flags. `-sn` is not cosmetic: a subtitle track would be mapped
// to webvtt, which the MPEG-TS muxer behind HLS rejects outright, killing the whole
// job before the first segment (any MKV with SRT did this).
// Input args for the HLS encode. `-ss` goes BEFORE `-i` (input seek): ffmpeg jumps
// to the keyframe before the target instead of decoding the film from 0, so a seek
// to the second hour costs a fraction of a second. Only a restart-at-offset sets it.
fn hls_input_args(offset_sec: f64) -> Vec<String> {
    let mut args = vec!["-y".to_string(), "-v".to_string(), "error".to_string()];
    if offset_sec > 0.0 {
        args.push("-ss".to_string());
        args.push(format!("{offset_sec:.3}"));
    }
    args
}

fn hls_format_args() -> Vec<&'static str> {
    vec![
        "-sn",
        "-f",
        "hls",
        "-hls_time",
        "4",
        "-hls_playlist_type",
        "event",
    ]
}

// Audio args for the HLS path only. ADTS, the AAC framing MPEG-TS uses, allows at
// most 7 channels: a 7.1 (8-channel) TrueHD/Atmos source makes ffmpeg refuse the
// whole job at header write ("channelConfiguration > 7 is not supported in ADTS"),
// so anything wider than 5.1 is downmixed to 6 channels. A source that already fits
// is left alone - `-ac` would upmix stereo.
fn hls_audio_args(action: AudioAction, channels: Option<u32>) -> Vec<&'static str> {
    let mut args = audio_convert_args(action);
    if action == AudioAction::Reencode && channels.is_some_and(|channels| channels > 6) {
        args.extend(["-ac", "6"]);
    }
    args
}

fn audio_convert_args(action: AudioAction) -> Vec<&'static str> {
    match action {
        AudioAction::Copy => vec!["-c:a", "copy"],
        // macOS: AudioToolbox (`aac_at`) encodes ~3x faster than even the fast
        // software coder (32-min file: 46s -> 13s) - it's the dominant cost of a
        // cache-miss transcode, so on the platform that has it we always use it.
        AudioAction::Reencode if cfg!(target_os = "macos") => vec!["-c:a", "aac_at"],
        // Elsewhere `-aac_coder fast` skips the default two-loop bit allocator:
        // ~4x faster than the default coder at transparent playback quality.
        AudioAction::Reencode => vec!["-c:a", "aac", "-aac_coder", "fast"],
        AudioAction::Drop => vec!["-an"],
    }
}

// Audio codec for the two-phase background re-encode (the full-audio file the FE
// swaps in). On macOS this is ALAC (Apple Lossless): being lossless it carries NO
// encoder priming, so it muxes with the copied video at a perfect 0ms A/V offset
// (lossy AAC adds a ~20ms priming frame that desyncs), and it encodes ~3x faster
// than aac_at (5s vs 14s on a 32-min file). AVFoundation plays ALAC natively.
// Chromium (WebView2) and WebKitGTK don't reliably decode ALAC, so off macOS we
// keep the fast AAC coder.
fn bg_audio_args() -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        return vec!["-c:a", "alac"];
    }
    vec!["-c:a", "aac", "-aac_coder", "fast"]
}

// Frontend -> same log file channel. The FE measures sub-second playback phases
// with performance.now() (the log timestamps are only second-granular) and sends
// the formatted one-liner here to land beside the backend prepare_media lines.
#[tauri::command]
pub fn log_playback(message: String) {
    log::info!("{message}");
}

// Kill + remove the previously streaming HLS job, if any. Called before starting
// a new one (only one video plays at a time) so old ffmpeg processes and segment
// dirs don't pile up in temp.
fn stop_current_hls(state: &MediaState) {
    let Some(job) = state.current_hls.lock().ok().and_then(|mut g| g.take()) else {
        return;
    };
    let pid = job.child.pid();
    let _ = job.child.kill();
    let _ = std::fs::remove_dir_all(&job.dir);
    log::info!(
        "prepare_media stopped previous HLS job pid={pid} dir={:?}",
        job.dir
    );
}

// Kill + remove the previous background audio re-encode, if any. A new file
// activation means the old swap is no longer wanted, so the half-written output
// is deleted to keep the remux temp dir from growing.
fn stop_current_bg(state: &MediaState) {
    let Some(job) = state.current_bg.lock().ok().and_then(|mut g| g.take()) else {
        return;
    };
    let pid = job.child.pid();
    let _ = job.child.kill();
    let _ = std::fs::remove_file(&job.out);
    log::info!(
        "prepare_media stopped previous bg audio job pid={pid} out={:?}",
        job.out
    );
}

#[tauri::command]
pub async fn prepare_media(app: tauri::AppHandle, path: String) -> Result<PreparedMedia, String> {
    let started = Instant::now();

    let ProbeResult {
        container,
        vcodec,
        acodec,
        duration_sec,
        channels,
    } = probe_media(&app, &path).await;
    if !has_playable_stream(&vcodec, &acodec) {
        log::error!("prepare_media failed: no audio or video stream (or bundled ffmpeg failed) path={path}");
        return Err(format!(
            "ffprobe found no audio or video stream (or bundled ffmpeg failed) for: {path}"
        ));
    }
    log::info!("prepare_media path={path} container={container} v={vcodec} a={acodec}");

    let plan = plan_media_for_webview(
        &container,
        &vcodec,
        &acodec,
        path.to_ascii_lowercase().ends_with(".webm"),
        cfg!(not(target_os = "macos")),
    );
    log::info!("prepare_media plan={plan:?}");

    // A new activation supersedes any in-flight work of either kind, and drops the
    // previous source's open handle (which also releases a deleted file's blocks).
    if let Some(state) = app.try_state::<MediaState>() {
        stop_current_hls(&state);
        stop_current_bg(&state);
        state.files.clear();
    }

    let strategy = match strategy_for(plan) {
        // Already webview-playable: serve the file untouched. No remux, no HLS, no
        // encode. It goes out over the loopback server from a handle we keep OPEN
        // for the session: the asset protocol re-opens the path on every byte-range
        // request, so deleting the file mid-playback killed it at the next request,
        // while an open handle keeps its bytes readable (VLC's behaviour).
        None => {
            if let Some(state) = app.try_state::<MediaState>() {
                let token = next_job_id().to_string();
                match std::fs::File::open(&path) {
                    Ok(file) => {
                        match state.files.insert(&token, file, std::path::Path::new(&path)) {
                            Ok(_) => {
                                let url = format!("http://127.0.0.1:{}/f/{token}", state.port);
                                log::info!(
                                    "prepare_media passthrough in {}ms path={path} url={url}",
                                    started.elapsed().as_millis()
                                );
                                return Ok(PreparedMedia {
                                    path: url,
                                    transcoded: false,
                                    duration_sec,
                                    swap_id: None,
                                });
                            }
                            Err(err) => log::error!(
                                "prepare_media passthrough could not read metadata: {err} path={path}"
                            ),
                        }
                    }
                    Err(err) => log::error!(
                        "prepare_media passthrough could not open file: {err} path={path}"
                    ),
                }
            }
            // Could not hold it open: fall back to the asset protocol (plays, but a
            // delete during playback ends it).
            log::info!(
                "prepare_media passthrough (asset) in {}ms path={path}",
                started.elapsed().as_millis()
            );
            return Ok(PreparedMedia {
                path,
                transcoded: false,
                duration_sec,
                swap_id: None,
            });
        }
        Some(strategy) => strategy,
    };

    match strategy {
        MediaStrategy::CompleteRemux { video, audio } => {
            complete_remux(&app, &path, video, audio, duration_sec, started).await
        }
        MediaStrategy::VideoThenAudio => {
            video_then_audio(&app, &path, duration_sec, started).await
        }
        MediaStrategy::HlsStream { video, audio } => {
            stream_hls(&app, &path, video, audio, channels, duration_sec, started, 0.0).await
        }
    }
}

// Restart the running HLS encode at `offset_sec` of the same source and return the
// new playlist URL. HLS cannot seek past the segments ffmpeg has already written,
// so a jump beyond them re-encodes from the target keyframe - the VLC model: the
// picture continues from there instead of the seek being refused or clamped.
#[tauri::command]
pub async fn seek_media(app: tauri::AppHandle, offset_sec: f64) -> Result<PreparedMedia, String> {
    let state = app
        .try_state::<MediaState>()
        .ok_or_else(|| "media state not initialised".to_string())?;
    let job = {
        let guard = state
            .current_hls
            .lock()
            .map_err(|_| "HLS state poisoned".to_string())?;
        guard.as_ref().map(|job| {
            (
                job.source.clone(),
                job.video,
                job.audio,
                job.channels,
                job.duration_sec,
            )
        })
    };
    let Some((source, video, audio, channels, duration_sec)) = job else {
        return Err("no HLS stream to seek".to_string());
    };

    stop_current_hls(&state);
    log::info!("seek_media offset={offset_sec:.3}s source={source}");
    stream_hls(
        &app,
        &source,
        video,
        audio,
        channels,
        duration_sec,
        Instant::now(),
        offset_sec,
    )
    .await
}

// One synchronous remux to a COMPLETE MP4 on disk. The video track is copied for a
// real video file or dropped (`-vn`) for an audio-only file. Audio is copied or
// re-encoded. Because the file is whole when `<video>` loads it, the element gets a
// finite duration and native random-access seeking - the HLS progressive stream
// (seekable.end == Infinity mid-encode) was what broke seeking. For h264+aac this
// is a container copy of both streams (~0.3s on a 32-min file).
async fn complete_remux(
    app: &tauri::AppHandle,
    path: &str,
    video: VideoAction,
    audio: AudioAction,
    duration_sec: Option<f64>,
    started: Instant,
) -> Result<PreparedMedia, String> {
    let state = app
        .try_state::<MediaState>()
        .ok_or_else(|| "media state not initialised".to_string())?;

    let out = state.remux_root.join(format!("{}.mp4", next_job_id()));
    let status = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("failed to resolve bundled ffmpeg: {e}"))?
        .args(["-y", "-v", "error", "-i", path])
        .args(video_convert_args(video))
        .args(audio_convert_args(audio))
        .args(["-movflags", "+faststart"])
        .arg(out.to_string_lossy().into_owned())
        .status()
        .await
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&out);
        log::error!("prepare_media remux failed code={:?} path={path}", status.code());
        return Err(format!("ffmpeg remux failed for: {path}"));
    }

    log::info!(
        "prepare_media complete remux in {}ms path={path} out={:?}",
        started.elapsed().as_millis(),
        out
    );
    Ok(PreparedMedia {
        path: out.to_string_lossy().into_owned(),
        transcoded: true,
        duration_sec,
        swap_id: None,
    })
}

// Two-phase path for a copyable video with bad audio (e.g. h264 + Opus). Phase A:
// remux a video-only MP4 (copy, no audio) - complete and instant, so seeking is
// native, just silent. Phase B (background): re-encode the full file with audio
// and emit `media://audio-ready` so the FE swaps src, preserving time + play
// state. This makes the picture feel as instant as VLC; sound arrives a moment
// later instead of blocking the whole open.
async fn video_then_audio(
    app: &tauri::AppHandle,
    path: &str,
    duration_sec: Option<f64>,
    started: Instant,
) -> Result<PreparedMedia, String> {
    let state = app
        .try_state::<MediaState>()
        .ok_or_else(|| "media state not initialised".to_string())?;

    let swap_id = next_job_id();
    let video_out = state.remux_root.join(format!("{swap_id}-v.mp4"));
    let status = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("failed to resolve bundled ffmpeg: {e}"))?
        .args(["-y", "-v", "error", "-i", path])
        .args(video_convert_args(VideoAction::Copy))
        .args(audio_convert_args(AudioAction::Drop))
        .args(["-movflags", "+faststart"])
        .arg(video_out.to_string_lossy().into_owned())
        .status()
        .await
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&video_out);
        log::error!(
            "prepare_media video-only remux failed code={:?} path={path}",
            status.code()
        );
        return Err(format!("ffmpeg video remux failed for: {path}"));
    }

    log::info!(
        "prepare_media video-only (silent) in {}ms swap_id={swap_id} path={path}",
        started.elapsed().as_millis()
    );

    spawn_bg_audio(app, path, swap_id, started);

    Ok(PreparedMedia {
        path: video_out.to_string_lossy().into_owned(),
        transcoded: true,
        duration_sec,
        swap_id: Some(swap_id),
    })
}

// Phase B of the two-phase path: re-encode the full file (video copied, audio to
// ALAC on macOS - see bg_audio_args) in the background and, on success, emit
// `media://audio-ready` carrying the swap_id + complete path. Registered as the
// current bg job so a newer activation can cancel it. A failed/killed encode just
// leaves the silent video playing.
fn spawn_bg_audio(app: &tauri::AppHandle, path: &str, swap_id: u64, started: Instant) {
    let Some(state) = app.try_state::<MediaState>() else {
        return;
    };
    let full_out = state.remux_root.join(format!("{swap_id}-full.mp4"));

    let command = match app.shell().sidecar("ffmpeg") {
        Ok(command) => command
            .args(["-y", "-v", "error", "-i", path])
            .args(video_convert_args(VideoAction::Copy))
            .args(bg_audio_args())
            .args(["-movflags", "+faststart"])
            .arg(full_out.to_string_lossy().into_owned()),
        Err(e) => {
            log::error!("bg audio: failed to resolve ffmpeg: {e}");
            return;
        }
    };

    let (mut rx, child) = match command.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            log::error!("bg audio: failed to spawn ffmpeg: {e}");
            return;
        }
    };

    *state.current_bg.lock().unwrap() = Some(BgJob {
        source: path.to_string(),
        child,
        out: full_out.clone(),
    });

    let app = app.clone();
    let source = path.to_string();
    async_runtime::spawn(async move {
        let mut succeeded = false;
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                succeeded = payload.code == Some(0);
            }
        }

        // Only honour this completion if it's still the current job for this
        // source - a newer activation may have superseded (and killed) it.
        let Some(state) = app.try_state::<MediaState>() else {
            return;
        };
        let is_current = state
            .current_bg
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|j| j.source == source))
            .unwrap_or(false);
        if !is_current {
            let _ = std::fs::remove_file(&full_out);
            return;
        }
        if !succeeded {
            log::error!("bg audio re-encode failed swap_id={swap_id} source={source}");
            return;
        }

        let _ = state.current_bg.lock().map(|mut g| g.take());
        log::info!(
            "prepare_media full-audio ready in {}ms swap_id={swap_id} source={source}",
            started.elapsed().as_millis()
        );
        let _ = app.emit(
            "media://audio-ready",
            AudioReadyPayload {
                swap_id,
                path: full_out.to_string_lossy().into_owned(),
            },
        );
    });
}

// Stream the file as HLS: ffmpeg writes an EVENT playlist + TS segments into a
// fresh per-job dir while we return the playlist URL as soon as the first segment
// exists. WKWebView's native player pulls the rest as they encode (the encoder
// runs ahead of realtime), so playback starts in ~0.2s instead of after the full
// transcode - the VLC "decode on the fly" model.
async fn stream_hls(
    app: &tauri::AppHandle,
    path: &str,
    video: VideoAction,
    audio: AudioAction,
    channels: Option<u32>,
    duration_sec: Option<f64>,
    started: Instant,
    offset_sec: f64,
) -> Result<PreparedMedia, String> {
    let state = app
        .try_state::<MediaState>()
        .ok_or_else(|| "HLS server not initialised".to_string())?;

    let job_id = next_job_id();
    let dir = state.hls_root.join(job_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create HLS dir: {e}"))?;
    let playlist = dir.join("index.m3u8");
    let segment_pattern = dir.join("seg%05d.ts");

    // A re-encode takes whichever encoder actually initialises here (hardware when
    // there is one); copies and drops don't care.
    let video_args = match video {
        VideoAction::Reencode => video_encode_args(select_video_encoder(app).await),
        other => video_convert_args(other),
    };

    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("failed to resolve bundled ffmpeg: {e}"))?
        .args(hls_input_args(offset_sec))
        .arg("-i")
        .arg(path)
        .args(video_args)
        .args(hls_audio_args(audio, channels))
        .args(hls_format_args())
        .arg("-hls_segment_filename")
        .arg(segment_pattern.to_string_lossy().into_owned())
        .arg(playlist.to_string_lossy().into_owned());

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to start ffmpeg: {e}"))?;

    // Drain the bounded stdout/stderr channel in a detached task so ffmpeg never
    // blocks on a full pipe buffer; record termination + stderr so the poll loop
    // can tell a real failure (exit != 0) from a clean finish.
    let terminated = Arc::new(AtomicBool::new(false));
    let succeeded = Arc::new(AtomicBool::new(false));
    let stderr = Arc::new(Mutex::new(String::new()));
    let (terminated_d, succeeded_d, stderr_d) =
        (terminated.clone(), succeeded.clone(), stderr.clone());
    async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Terminated(payload) => {
                    succeeded_d.store(payload.code == Some(0), Ordering::SeqCst);
                    terminated_d.store(true, Ordering::SeqCst);
                }
                CommandEvent::Stderr(bytes) => {
                    if let Ok(mut s) = stderr_d.lock() {
                        s.push_str(&String::from_utf8_lossy(&bytes));
                    }
                }
                _ => {}
            }
        }
    });

    let first_segment = dir.join("seg00000.ts");
    let result = poll_first_segment(&playlist, &first_segment, &terminated, &succeeded, started);
    match result {
        Ok(()) => {
            let url = format!("http://localhost:{}/{job_id}/index.m3u8", state.port);
            *state
                .current_hls
                .lock()
                .map_err(|_| "HLS state poisoned".to_string())? = Some(HlsJob {
                dir,
                child,
                source: path.to_string(),
                video,
                audio,
                channels,
                duration_sec,
            });
            log::info!(
                "prepare_media HLS first segment in {}ms path={path} url={url}",
                started.elapsed().as_millis()
            );
            Ok(PreparedMedia {
                path: url,
                transcoded: true,
                duration_sec,
                swap_id: None,
            })
        }
        Err(reason) => {
            let _ = child.kill();
            let _ = std::fs::remove_dir_all(&dir);
            let detail = stderr
                .lock()
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            log::error!("prepare_media failed: {reason} path={path} stderr={detail}");
            Err(format!("ffmpeg transcode failed for: {path}"))
        }
    }
}

// Block until the playlist + first segment exist (ready to stream), ffmpeg dies,
// or we time out. The encoder is far faster than realtime, so this returns in a
// fraction of a second for normal files.
fn poll_first_segment(
    playlist: &std::path::Path,
    first_segment: &std::path::Path,
    terminated: &AtomicBool,
    succeeded: &AtomicBool,
    started: Instant,
) -> Result<(), String> {
    loop {
        if playlist.exists() && first_segment.exists() {
            return Ok(());
        }
        if terminated.load(Ordering::SeqCst) {
            // A clean exit before the first segment means a tiny clip the playlist
            // still describes; only a non-zero exit is a real failure.
            if succeeded.load(Ordering::SeqCst) && playlist.exists() {
                return Ok(());
            }
            return Err("ffmpeg exited before producing a segment".to_string());
        }
        if started.elapsed() > FIRST_SEGMENT_TIMEOUT {
            return Err("timed out waiting for first HLS segment".to_string());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        audio_convert_args, bg_audio_args, hls_audio_args, hls_format_args, hls_input_args,
        parse_probe_json,
        plan_media, plan_media_for_webview, strategy_for, video_convert_args,
        video_encode_args, video_encoder_candidates, AudioAction, MediaPlan, MediaStrategy,
        ProbeResult, VideoAction,
    };

    // The bundled ffmpeg builds are LGPL (BtbN) and are compiled with
    // `--disable-libx264`, so the re-encode path must name an encoder that is
    // actually present or every VP9/AV1 file fails at startup.
    #[test]
    fn reencode_video_uses_an_encoder_in_the_bundled_build() {
        let args = video_convert_args(VideoAction::Reencode);
        if cfg!(target_os = "macos") {
            assert!(args.contains(&"h264_videotoolbox"), "args: {args:?}");
        } else {
            assert!(args.contains(&"libopenh264"), "args: {args:?}");
        }
    }

    const MP4: &str = "mov,mp4,m4a,3gp,3g2,mj2";
    const MKV: &str = "matroska,webm";

    const MP4_H264_AAC_JSON: &str = r#"{
        "programs": [],
        "stream_groups": [],
        "streams": [
            { "codec_name": "h264", "codec_type": "video" },
            { "codec_name": "aac", "codec_type": "audio" }
        ],
        "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" }
    }"#;

    const MKV_H264_OPUS_JSON: &str = r#"{
        "programs": [],
        "stream_groups": [],
        "streams": [
            { "codec_name": "h264", "codec_type": "video" },
            { "codec_name": "opus", "codec_type": "audio" }
        ],
        "format": { "format_name": "matroska,webm" }
    }"#;

    // TC-001: mp4 + h264 + aac is served untouched (AC-005)
    #[test]
    fn should_passthrough_when_mp4_h264_aac() {
        assert_eq!(plan_media(MP4, "h264", "aac"), MediaPlan::Passthrough);
    }

    // TC-007: mp4 + h264 + mp3 is also fine (AC-005)
    #[test]
    fn should_passthrough_when_mp4_h264_mp3() {
        assert_eq!(plan_media(MP4, "h264", "mp3"), MediaPlan::Passthrough);
    }

    // TC-002: h264 in mkv only needs a container remux - copy both streams (AC-002)
    #[test]
    fn should_remux_copy_when_mkv_h264_aac() {
        assert_eq!(
            plan_media(MKV, "h264", "aac"),
            MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Copy,
            }
        );
    }

    // TC-003: vp9 + opus needs full re-encode of both (AC-003, AC-004)
    #[test]
    fn should_reencode_both_when_mkv_vp9_opus() {
        assert_eq!(
            plan_media(MKV, "vp9", "opus"),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            }
        );
    }

    // Chromium (WebView2/WebKitGTK) decodes AV1+Opus in a .webm natively, so the
    // original file can be served untouched - no transcode, instant start.
    #[test]
    fn should_passthrough_when_webm_av1_opus_and_webview_is_chromium() {
        assert_eq!(
            plan_media_for_webview(MKV, "av1", "opus", true, true),
            MediaPlan::Passthrough
        );
    }

    // WKWebView cannot play file-based WebM at all, so the same file still needs
    // the re-encode path on macOS.
    #[test]
    fn should_reencode_when_webm_av1_opus_and_webview_is_wkwebview() {
        assert_eq!(
            plan_media_for_webview(MKV, "av1", "opus", true, false),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            }
        );
    }

    // ffprobe reports "matroska,webm" for BOTH .mkv and .webm; Chromium does not
    // demux full Matroska, so only the .webm extension may take the fast path.
    #[test]
    fn should_reencode_when_matroska_file_is_not_a_webm() {
        assert_eq!(
            plan_media_for_webview(MKV, "vp9", "opus", false, true),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            }
        );
    }

    // Codecs outside Chromium's native set stay on the re-encode path.
    #[test]
    fn should_reencode_when_webm_video_codec_is_not_chromium_native() {
        assert_eq!(
            plan_media_for_webview(MKV, "hevc", "opus", true, true),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            }
        );
    }

    // TC-004: mp4 container but av1 video - re-encode video, copy the fine audio (AC-003)
    #[test]
    fn should_reencode_video_copy_audio_when_mp4_av1_aac() {
        assert_eq!(
            plan_media(MP4, "av1", "aac"),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Copy,
            }
        );
    }

    // TC-005: no audio stream -> drop audio (AC-004)
    #[test]
    fn should_drop_audio_when_mkv_h264_no_audio() {
        assert_eq!(
            plan_media(MKV, "h264", ""),
            MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Drop,
            }
        );
    }

    // TC-006: avi + h264 + ac3 - copy video, re-encode the bad audio (AC-004)
    #[test]
    fn should_copy_video_reencode_audio_when_avi_h264_ac3() {
        assert_eq!(
            plan_media("avi", "h264", "ac3"),
            MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Reencode,
            }
        );
    }

    // AC-002: one ffprobe json yields container + video codec + audio codec
    #[test]
    fn should_populate_all_fields_when_parsing_mp4_h264_aac_json() {
        assert_eq!(
            parse_probe_json(MP4_H264_AAC_JSON),
            ProbeResult {
                container: MP4.to_string(),
                vcodec: "h264".to_string(),
                acodec: "aac".to_string(),
                duration_sec: None,
                channels: None,
            }
        );
    }

    // AC-002: mkv h264 + opus parsed correctly
    #[test]
    fn should_populate_all_fields_when_parsing_mkv_h264_opus_json() {
        assert_eq!(
            parse_probe_json(MKV_H264_OPUS_JSON),
            ProbeResult {
                container: MKV.to_string(),
                vcodec: "h264".to_string(),
                acodec: "opus".to_string(),
                duration_sec: None,
                channels: None,
            }
        );
    }

    // FR-14 duration: format.duration (a seconds string) is parsed to f64 so the FE
    // can show a real length while an HLS stream's own duration is still Infinity
    #[test]
    fn should_parse_duration_seconds_when_present_in_json() {
        let json = r#"{
            "streams": [
                { "codec_name": "h264", "codec_type": "video" }
            ],
            "format": { "format_name": "matroska,webm", "duration": "1922.581000" }
        }"#;
        assert_eq!(parse_probe_json(json).duration_sec, Some(1922.581));
    }

    // duration is optional - a payload without format.duration yields None, not a panic
    #[test]
    fn should_leave_duration_none_when_absent_from_json() {
        assert_eq!(parse_probe_json(MKV_H264_OPUS_JSON).duration_sec, None);
    }

    // AC-002 / AC-005 edge: no audio stream -> acodec == ""
    #[test]
    fn should_leave_acodec_empty_when_no_audio_stream_in_json() {
        let json = r#"{
            "streams": [
                { "codec_name": "h264", "codec_type": "video" }
            ],
            "format": { "format_name": "matroska,webm" }
        }"#;
        let result = parse_probe_json(json);
        assert_eq!(result.vcodec, "h264");
        assert_eq!(result.acodec, "");
    }

    // AC-005: no video stream (audio only) -> vcodec == ""
    #[test]
    fn should_leave_vcodec_empty_when_no_video_stream_in_json() {
        let json = r#"{
            "streams": [
                { "codec_name": "aac", "codec_type": "audio" }
            ],
            "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" }
        }"#;
        let result = parse_probe_json(json);
        assert_eq!(result.vcodec, "");
        assert_eq!(result.acodec, "aac");
    }

    // edge: junk / non-json input -> all-empty ProbeResult, no panic
    #[test]
    fn should_return_empty_result_when_parsing_junk_input() {
        assert_eq!(
            parse_probe_json("not json at all {{{"),
            ProbeResult {
                container: String::new(),
                vcodec: String::new(),
                acodec: String::new(),
                duration_sec: None,
                channels: None,
            }
        );
    }

    // edge: empty string -> all-empty ProbeResult, no panic
    #[test]
    fn should_return_empty_result_when_parsing_empty_string() {
        assert_eq!(
            parse_probe_json(""),
            ProbeResult {
                container: String::new(),
                vcodec: String::new(),
                acodec: String::new(),
                duration_sec: None,
                channels: None,
            }
        );
    }

    // an aac re-encode must use the fast path. On macOS that's AudioToolbox
    // (`aac_at`); elsewhere the software fast coder (the default two-loop coder is
    // ~4x slower on long files, the dominant cost of a cache-miss transcode).
    #[test]
    fn should_use_fast_aac_encoder_when_reencoding_audio() {
        let args = audio_convert_args(AudioAction::Reencode);
        if cfg!(target_os = "macos") {
            assert!(args.contains(&"aac_at"));
            return;
        }
        let coder = args.iter().position(|&a| a == "-aac_coder");
        assert_eq!(coder.and_then(|i| args.get(i + 1)), Some(&"fast"));
    }

    // the two-phase background re-encode uses a lossless codec on macOS (ALAC, no
    // priming -> perfect A/V sync); elsewhere the fast AAC coder
    #[test]
    fn should_use_lossless_audio_for_background_reencode_on_macos() {
        let args = bg_audio_args();
        if cfg!(target_os = "macos") {
            assert!(args.contains(&"alac"));
            return;
        }
        assert!(args.contains(&"aac"));
    }

    // passthrough has no work to do -> no strategy
    #[test]
    fn should_have_no_strategy_when_passthrough() {
        assert_eq!(strategy_for(MediaPlan::Passthrough), None);
    }

    // h264 + aac in mkv: video copies, audio already fine -> one complete remux
    #[test]
    fn should_complete_remux_when_video_copy_audio_copy() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Copy,
            }),
            Some(MediaStrategy::CompleteRemux {
                video: VideoAction::Copy,
                audio: AudioAction::Copy
            })
        );
    }

    // h264, no audio: video copies, audio dropped -> still one complete remux
    #[test]
    fn should_complete_remux_when_video_copy_audio_drop() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Drop,
            }),
            Some(MediaStrategy::CompleteRemux {
                video: VideoAction::Copy,
                audio: AudioAction::Drop
            })
        );
    }

    // h264 + opus: video copies but audio needs re-encoding -> two-phase
    // (instant video, audio dubbed in the background)
    #[test]
    fn should_video_then_audio_when_video_copy_audio_reencode() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Reencode,
            }),
            Some(MediaStrategy::VideoThenAudio)
        );
    }

    // vp9 + opus: the video itself must be re-encoded -> no instant copy, keep HLS
    #[test]
    fn should_hls_stream_when_video_reencode() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            }),
            Some(MediaStrategy::HlsStream {
                video: VideoAction::Reencode,
                audio: AudioAction::Reencode,
            })
        );
    }

    const MKV_TRUEHD_71_JSON: &str = r#"{
        "programs": [],
        "stream_groups": [],
        "streams": [
            { "codec_name": "hevc", "codec_type": "video" },
            { "codec_name": "truehd", "codec_type": "audio", "channels": 8 }
        ],
        "format": { "format_name": "matroska,webm" }
    }"#;

    // The HLS audio path needs the channel count: ADTS (AAC inside MPEG-TS) tops out
    // at 7 channels, so an 8-channel source has to be downmixed.
    #[test]
    fn should_parse_channel_count_when_audio_stream_reports_one() {
        assert_eq!(parse_probe_json(MKV_TRUEHD_71_JSON).channels, Some(8));
    }

    #[test]
    fn should_leave_channel_count_none_when_no_audio_stream_has_one() {
        assert_eq!(parse_probe_json(MP4_H264_AAC_JSON).channels, None);
    }

    // A 7.1 TrueHD source kills the whole HLS job at header write with
    // "channelConfiguration > 7 is not supported in ADTS", so >6 channels must be
    // downmixed to 5.1 - the stream otherwise never starts at all.
    #[test]
    fn should_downmix_to_5_1_when_hls_source_has_more_than_7_channels() {
        let args = hls_audio_args(AudioAction::Reencode, Some(8));
        assert!(args.contains(&"-ac"), "args: {args:?}");
        assert!(args.contains(&"6"), "args: {args:?}");
    }

    // A 5.1 or stereo source already fits ADTS: downmixing it would change how it
    // sounds for no reason.
    #[test]
    fn should_keep_channels_when_hls_source_fits_adts() {
        let args = hls_audio_args(AudioAction::Reencode, Some(6));
        assert!(!args.contains(&"-ac"), "args: {args:?}");
    }

    // A hardware encoder is worth 10x+ on a big source (measured: 10s of 4K HEVC
    // takes 8.4s through libopenh264, 3.6s through NVENC), so the probe order must
    // try hardware first and only fall back to software.
    #[test]
    fn should_try_hardware_encoders_before_the_software_one() {
        let candidates = video_encoder_candidates();
        if cfg!(target_os = "macos") {
            assert_eq!(candidates, ["h264_videotoolbox"]);
            return;
        }
        assert_eq!(
            candidates.last(),
            Some(&"libopenh264"),
            "software must be the last resort, got: {candidates:?}"
        );
        assert!(
            candidates.len() > 2,
            "expected several hardware candidates, got: {candidates:?}"
        );
    }

    // An MKV with SRT subtitles maps them to webvtt, which the MPEG-TS muxer behind
    // HLS cannot take: the whole job dies at header write ("Invalid data found"),
    // so the stream must carry picture + sound only.
    #[test]
    fn should_drop_subtitles_when_streaming_hls() {
        let args = hls_format_args();
        assert!(args.contains(&"-sn"), "args: {args:?}");
        assert!(args.contains(&"hls"), "args: {args:?}");
    }

    // A fresh prepare encodes from the beginning: no `-ss`, so ffmpeg reads the file
    // from 0 and the playlist starts at 00:00.
    #[test]
    fn should_not_seek_when_streaming_from_the_start() {
        let args = hls_input_args(0.0);
        assert!(!args.contains(&"-ss".to_string()), "args: {args:?}");
    }

    // Seeking past the written segments restarts the encode at the target, and the
    // seek must be an INPUT seek placed before `-i` (a keyframe jump, not a decode
    // from 0).
    #[test]
    fn should_seek_from_an_offset_when_restarting_the_stream() {
        let args = hls_input_args(3600.5);
        let ss = args.iter().position(|a| a == "-ss");
        assert_eq!(ss.and_then(|i| args.get(i + 1)), Some(&"3600.500".to_string()));
    }

    // 10-bit sources (HEVC/AV1) cannot go through the 8-bit H.264 encoders, so a
    // re-encode must pin yuv420p - but only off macOS, where VideoToolbox handles
    // 10-bit/HDR itself.
    #[test]
    fn should_pin_8_bit_pixel_format_when_encoding_with_a_given_encoder() {
        let args = video_encode_args("h264_nvenc");
        assert!(args.contains(&"h264_nvenc"), "args: {args:?}");
        if cfg!(target_os = "macos") {
            assert!(!args.contains(&"yuv420p"), "args: {args:?}");
        } else {
            assert!(args.contains(&"yuv420p"), "args: {args:?}");
        }
    }
}

// Audio player support (spec docs/features/20260718222553-audio-player-support).
// Isolated module so the new-name red state (VideoAction::None, has_playable_stream,
// audio-only plan/strategy, cover-art skip) is legible and does not collide with the
// existing `mod tests` imports.
#[cfg(test)]
mod audio_media_tests {
    use super::{
        has_playable_stream, parse_probe_json, plan_media, strategy_for, AudioAction, MediaPlan,
        MediaStrategy, VideoAction,
    };

    const MP4: &str = "mov,mp4,m4a,3gp,3g2,mj2";
    const MKV: &str = "matroska,webm";

    // TC-001 (behavior): mp3 in an mp3 container is a webview-native audio-only file
    // -> served untouched (AC-002).
    #[test]
    fn should_passthrough_when_mp3_container_mp3_audio_only() {
        assert_eq!(plan_media("mp3", "", "mp3"), MediaPlan::Passthrough);
    }

    // TC-002 (behavior): aac in the mp4/m4a family with no video stream is native
    // audio-only -> passthrough (AC-002).
    #[test]
    fn should_passthrough_when_m4a_aac_audio_only() {
        assert_eq!(plan_media(MP4, "", "aac"), MediaPlan::Passthrough);
    }

    // TC-003 (behavior): flac in a flac container is native audio-only -> passthrough (AC-002).
    #[test]
    fn should_passthrough_when_flac_container_flac_audio_only() {
        assert_eq!(plan_media("flac", "", "flac"), MediaPlan::Passthrough);
    }

    // TC-004 (behavior): pcm in a wav container is native audio-only -> passthrough (AC-002).
    #[test]
    fn should_passthrough_when_wav_pcm_audio_only() {
        assert_eq!(plan_media("wav", "", "pcm_s16le"), MediaPlan::Passthrough);
    }

    // TC-005 (behavior): opus in ogg is non-native audio-only -> drop the (absent)
    // video track and re-encode the audio to AAC (AC-003).
    #[test]
    fn should_convert_none_reencode_when_ogg_opus_audio_only() {
        assert_eq!(
            plan_media("ogg", "", "opus"),
            MediaPlan::Convert {
                video: VideoAction::None,
                audio: AudioAction::Reencode,
            }
        );
    }

    // TC-006 (behavior): wmav2 in asf is non-native audio-only -> None + Reencode (AC-003).
    #[test]
    fn should_convert_none_reencode_when_asf_wmav2_audio_only() {
        assert_eq!(
            plan_media("asf", "", "wmav2"),
            MediaPlan::Convert {
                video: VideoAction::None,
                audio: AudioAction::Reencode,
            }
        );
    }

    // E-3 (behavior): raw aac ADTS (native codec in the non-native `aac` container)
    // is NOT passthrough - the audio is copied into a complete mp4, video dropped (AC-003).
    #[test]
    fn should_convert_none_copy_when_raw_aac_adts_audio_only() {
        assert_eq!(
            plan_media("aac", "", "aac"),
            MediaPlan::Convert {
                video: VideoAction::None,
                audio: AudioAction::Copy,
            }
        );
    }

    // TC-007 (behavior): an audio-only Convert that re-encodes audio maps to a single
    // complete remux with the video track dropped - never HLS (AC-003).
    #[test]
    fn should_complete_remux_none_reencode_when_audio_only_reencode() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::None,
                audio: AudioAction::Reencode,
            }),
            Some(MediaStrategy::CompleteRemux {
                video: VideoAction::None,
                audio: AudioAction::Reencode,
            })
        );
    }

    // TC-008 (behavior): an audio-only Convert that can copy the audio (e.g. raw aac
    // ADTS into mp4) still maps to a complete remux with the video dropped (AC-003, E-3).
    #[test]
    fn should_complete_remux_none_copy_when_audio_only_copy() {
        assert_eq!(
            strategy_for(MediaPlan::Convert {
                video: VideoAction::None,
                audio: AudioAction::Copy,
            }),
            Some(MediaStrategy::CompleteRemux {
                video: VideoAction::None,
                audio: AudioAction::Copy,
            })
        );
    }

    // TC-009 (behavior): a cover-art stream (mjpeg, disposition.attached_pic == 1) is
    // NOT a real video track - the probe ignores it, so the file reads as audio-only
    // (vcodec == "", acodec == "mp3") (AC-005).
    #[test]
    fn should_ignore_cover_art_stream_when_parsing_probe_json() {
        let json = r#"{
            "streams": [
                { "codec_name": "mjpeg", "codec_type": "video", "disposition": { "attached_pic": 1 } },
                { "codec_name": "mp3", "codec_type": "audio" }
            ],
            "format": { "format_name": "mp3" }
        }"#;
        let result = parse_probe_json(json);
        assert_eq!(result.vcodec, "");
        assert_eq!(result.acodec, "mp3");
    }

    // TC-010 (behavior): a genuine motion-video stream (attached_pic == 0) is still
    // detected as video - the cover-art skip must not swallow real video (AC-005 negative).
    #[test]
    fn should_keep_real_video_when_attached_pic_is_zero() {
        let json = r#"{
            "streams": [
                { "codec_name": "h264", "codec_type": "video", "disposition": { "attached_pic": 0 } },
                { "codec_name": "aac", "codec_type": "audio" }
            ],
            "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" }
        }"#;
        assert_eq!(parse_probe_json(json).vcodec, "h264");
    }

    // TC-011 (behavior): the prepare_media guard - a file is playable when it has at
    // least one stream; only neither-stream is unplayable (AC-004, E-2).
    #[test]
    fn should_report_unplayable_only_when_neither_stream_present() {
        assert!(!has_playable_stream("", ""));
        assert!(has_playable_stream("", "aac"));
        assert!(has_playable_stream("h264", ""));
    }

    // TC-014 (behavior, regression): existing video plans are unchanged by the
    // audio widening - passthrough, container-copy, and video-reencode all hold (AC-008).
    #[test]
    fn should_leave_video_plans_unchanged_when_widening_for_audio() {
        assert_eq!(plan_media(MP4, "h264", "aac"), MediaPlan::Passthrough);
        assert_eq!(
            plan_media(MKV, "h264", "opus"),
            MediaPlan::Convert {
                video: VideoAction::Copy,
                audio: AudioAction::Reencode,
            }
        );
        assert_eq!(
            plan_media(MKV, "av1", "aac"),
            MediaPlan::Convert {
                video: VideoAction::Reencode,
                audio: AudioAction::Copy,
            }
        );
    }
}
