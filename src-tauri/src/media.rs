use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use serde::Serialize;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct PreparedMedia {
    pub path: String,
    pub transcoded: bool,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum VideoAction {
    Copy,
    Reencode,
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

// Pure decision: given the container (ffprobe format_name), video codec and audio
// codec (a:"" = no audio), decide what the webview needs. MP4-family + h264 +
// webview-playable audio is served untouched; anything else is converted, copying
// the streams that are already fine and re-encoding only those that are not.
fn plan_media(container: &str, vcodec: &str, acodec: &str) -> MediaPlan {
    let video = if vcodec == "h264" {
        VideoAction::Copy
    } else {
        VideoAction::Reencode
    };
    let audio = match acodec {
        "" => AudioAction::Drop,
        "aac" | "mp3" => AudioAction::Copy,
        _ => AudioAction::Reencode,
    };
    let is_mp4_container = container.contains("mp4");
    let is_webview_ready = video == VideoAction::Copy && audio != AudioAction::Reencode;
    if is_mp4_container && is_webview_ready {
        return MediaPlan::Passthrough;
    }
    MediaPlan::Convert { video, audio }
}

async fn probe_stream(app: &tauri::AppHandle, path: &str, stream: &str) -> String {
    let command = match app.shell().sidecar("ffprobe") {
        Ok(command) => command,
        Err(_) => return String::new(),
    };
    let output = command
        .args([
            "-v", "error", "-select_streams", stream, "-show_entries",
            "stream=codec_name", "-of", "csv=p=0", path,
        ])
        .output()
        .await;
    match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

async fn probe_container(app: &tauri::AppHandle, path: &str) -> String {
    let command = match app.shell().sidecar("ffprobe") {
        Ok(command) => command,
        Err(_) => return String::new(),
    };
    let output = command
        .args([
            "-v", "error", "-show_entries", "format=format_name",
            "-of", "csv=p=0", path,
        ])
        .output()
        .await;
    match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

fn cache_path(source: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    let mut dir = std::env::temp_dir();
    dir.push("vidui-transcode");
    let _ = std::fs::create_dir_all(&dir);
    dir.push(format!("{:x}.mp4", hasher.finish()));
    dir
}

fn video_convert_args(action: VideoAction) -> Vec<&'static str> {
    match action {
        VideoAction::Copy => vec!["-c:v", "copy"],
        VideoAction::Reencode if cfg!(target_os = "macos") => {
            vec!["-c:v", "h264_videotoolbox", "-b:v", "6M"]
        }
        VideoAction::Reencode => {
            vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
        }
    }
}

fn audio_convert_args(action: AudioAction) -> Vec<&'static str> {
    match action {
        AudioAction::Copy => vec!["-c:a", "copy"],
        AudioAction::Reencode => vec!["-c:a", "aac"],
        AudioAction::Drop => vec!["-an"],
    }
}

#[tauri::command]
pub async fn prepare_media(
    app: tauri::AppHandle,
    path: String,
) -> Result<PreparedMedia, String> {
    let vcodec = probe_stream(&app, &path, "v:0").await;
    if vcodec.is_empty() {
        return Err(format!(
            "ffprobe found no video stream (or bundled ffmpeg failed) for: {path}"
        ));
    }
    let acodec = probe_stream(&app, &path, "a:0").await;
    let container = probe_container(&app, &path).await;

    let plan = plan_media(&container, &vcodec, &acodec);
    let (video, audio) = match plan {
        MediaPlan::Passthrough => {
            return Ok(PreparedMedia { path, transcoded: false });
        }
        MediaPlan::Convert { video, audio } => (video, audio),
    };

    let target = cache_path(&path);
    // Only a COMPLETE encode is ever renamed to the final path, so existence
    // alone means a finished, reusable file.
    if target.exists() {
        return Ok(PreparedMedia {
            path: target.to_string_lossy().into_owned(),
            transcoded: true,
        });
    }
    let part = target.with_extension("mp4.part");
    let _ = std::fs::remove_file(&part);

    // Write a COMPLETE, finalized MP4 (moov written + faststart, seekable) - NOT
    // a fragmented/empty-moov stream. A growing fragmented file made <video> read
    // a stale size and report the wrong duration. We wait for ffmpeg to finish,
    // then atomically rename .part -> final. Copying a stream (remux) is near
    // instant; only a true re-encode is slow.
    let part_str = part.to_string_lossy().into_owned();
    let command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("failed to resolve bundled ffmpeg: {e}"))?
        .args(["-y", "-v", "error", "-i", &path])
        .args(video_convert_args(video))
        .args(audio_convert_args(audio))
        .args(["-movflags", "+faststart", &part_str]);

    let (mut rx, _child) = command
        .spawn()
        .map_err(|e| format!("failed to start ffmpeg: {e}"))?;

    // The shell plugin force-pipes stdout/stderr into a bounded channel; drain it
    // to completion (which also yields the Terminated exit code) so ffmpeg never
    // blocks on a full pipe buffer.
    let mut code = None;
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Terminated(payload) = event {
            code = payload.code;
        }
    }

    if code != Some(0) {
        let _ = std::fs::remove_file(&part);
        return Err(format!("ffmpeg transcode failed for: {path}"));
    }
    std::fs::rename(&part, &target)
        .map_err(|e| format!("failed to finalize transcode for {path}: {e}"))?;

    Ok(PreparedMedia {
        path: target.to_string_lossy().into_owned(),
        transcoded: true,
    })
}

#[cfg(test)]
mod tests {
    use super::{cache_path, plan_media, AudioAction, MediaPlan, VideoAction};

    const MP4: &str = "mov,mp4,m4a,3gp,3g2,mj2";
    const MKV: &str = "matroska,webm";

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

    #[test]
    fn should_return_same_path_when_called_twice_with_same_source() {
        let source = "/some/video/file.mkv";
        assert_eq!(cache_path(source), cache_path(source));
    }

    #[test]
    fn should_land_under_vidui_transcode_dir_when_building_cache_path() {
        let path = cache_path("/some/video/file.mkv");
        assert!(path.to_string_lossy().contains("vidui-transcode"));
    }

    #[test]
    fn should_have_mp4_suffix_when_building_cache_path() {
        let path = cache_path("/some/video/file.mkv");
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("mp4"));
    }
}
