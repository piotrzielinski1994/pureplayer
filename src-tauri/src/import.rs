use std::path::Path;

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "mov", "webm", "avi"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma"];

fn has_media_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .map(|ext| {
            VIDEO_EXTENSIONS.contains(&ext.as_str()) || AUDIO_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

// Best-effort recursive walk: an unreadable dir is skipped (never fatal),
// symlinked dirs are not followed (only real `is_dir` entries are descended),
// so a symlink loop cannot hang the walk.
fn collect_into(path: &Path, out: &mut Vec<String>) {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return,
    };
    if metadata.file_type().is_symlink() {
        return;
    }
    if metadata.is_dir() {
        let entries = match std::fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            collect_into(&entry.path(), out);
        }
        return;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if has_media_extension(name) {
        out.push(path.to_string_lossy().into_owned());
    }
}

fn collect_media_paths(roots: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for root in roots {
        collect_into(Path::new(root), &mut out);
    }
    out.sort();
    out.dedup();
    out
}

#[tauri::command]
pub fn expand_dropped_paths(paths: Vec<String>) -> Vec<String> {
    collect_media_paths(&paths)
}

#[cfg(test)]
mod tests {
    use super::{collect_media_paths, has_media_extension};
    use std::fs;
    use std::path::PathBuf;

    // A deterministic temp dir keyed on a per-test label (no rand crate, mirroring
    // media.rs's reliance on std::env::temp_dir). Cleaned up before and after.
    fn fresh_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("pureplayer-import-test-{label}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn cleanup(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    fn as_string(path: PathBuf) -> String {
        path.to_string_lossy().into_owned()
    }

    // behavior: a lowercase known video extension is accepted (AC-003 / TC-008)
    #[test]
    fn should_accept_when_extension_is_mp4() {
        assert!(has_media_extension("clip.mp4"));
    }

    // behavior: extension match is case-insensitive for an uppercase ext (AC-003 / TC-008)
    #[test]
    fn should_accept_when_extension_is_uppercase_mkv() {
        assert!(has_media_extension("CLIP.MKV"));
    }

    // behavior: a mixed-case .MOV is still a video (AC-003 / TC-008)
    #[test]
    fn should_accept_when_extension_is_mov_uppercase() {
        assert!(has_media_extension("a.MOV"));
    }

    // behavior: a non-media extension is rejected (AC-003 / TC-008)
    #[test]
    fn should_reject_when_extension_is_txt() {
        assert!(!has_media_extension("notes.txt"));
    }

    // behavior: a name with no extension is rejected (AC-003 / TC-008)
    #[test]
    fn should_reject_when_name_has_no_extension() {
        assert!(!has_media_extension("noext"));
    }

    // behavior: a directory is recursed (any depth) and only media files are kept, sorted (AC-002/AC-003 / TC-003)
    #[test]
    fn should_keep_only_media_recursively_sorted_when_walking_a_dir() {
        let root = fresh_dir("recurse");
        fs::write(root.join("clip.mp4"), b"x").expect("write clip");
        fs::write(root.join("notes.txt"), b"x").expect("write notes");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create nested");
        fs::write(nested.join("deep.mkv"), b"x").expect("write deep");

        let result = collect_media_paths(&[as_string(root.clone())]);

        let expected = vec![
            as_string(root.join("clip.mp4")),
            as_string(root.join("nested").join("deep.mkv")),
        ];
        cleanup(&root);
        assert_eq!(result, expected);
    }

    // behavior: a path passed twice yields a single entry (AC-006 / E-4)
    #[test]
    fn should_dedupe_when_the_same_path_is_passed_twice() {
        let root = fresh_dir("dedupe");
        fs::write(root.join("a.mp4"), b"x").expect("write a");
        let a = as_string(root.join("a.mp4"));

        let result = collect_media_paths(&[a.clone(), a.clone()]);

        cleanup(&root);
        assert_eq!(result, vec![a]);
    }

    // behavior: a directory with no media yields an empty vec (AC-008 / E-2 / TC-007)
    #[test]
    fn should_return_empty_when_dir_has_no_media() {
        let root = fresh_dir("nomedia");
        fs::write(root.join("readme.md"), b"x").expect("write readme");

        let result = collect_media_paths(&[as_string(root.clone())]);

        cleanup(&root);
        assert!(result.is_empty());
    }

    // behavior: an empty root list yields an empty vec (AC-008 supporting)
    #[test]
    fn should_return_empty_when_no_roots_given() {
        let result = collect_media_paths(&[]);
        assert!(result.is_empty());
    }
}

// Audio player support (spec docs/features/20260718222553-audio-player-support).
// Isolated module targeting the renamed helpers (has_media_extension /
// collect_media_paths) that accept the audio extension set. Kept separate so the
// new-name red state is legible against the existing (renamed-later) suite above.
#[cfg(test)]
mod media_import_tests {
    use super::{collect_media_paths, has_media_extension};
    use std::fs;
    use std::path::PathBuf;

    fn fresh_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("pureplayer-media-import-test-{label}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn cleanup(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    fn as_string(path: PathBuf) -> String {
        path.to_string_lossy().into_owned()
    }

    // TC-012 (behavior): audio and video extensions are accepted, case-insensitively;
    // a non-media extension and a name with no extension are rejected (AC-001).
    #[test]
    fn should_accept_media_extensions_and_reject_others() {
        assert!(has_media_extension("song.mp3"));
        assert!(has_media_extension("a.FLAC"));
        assert!(has_media_extension("x.OPUS"));
        assert!(has_media_extension("clip.mp4"));
        assert!(has_media_extension("CLIP.MKV"));
        assert!(!has_media_extension("doc.pdf"));
        assert!(!has_media_extension("noext"));
    }

    // TC-013 (behavior): a mixed tree keeps audio + video files sorted and excludes
    // non-media ones (AC-001, E-7).
    #[test]
    fn should_collect_audio_and_video_sorted_excluding_non_media() {
        let root = fresh_dir("mixed");
        fs::write(root.join("song.mp3"), b"x").expect("write song");
        fs::write(root.join("notes.txt"), b"x").expect("write notes");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create nested");
        fs::write(nested.join("clip.mp4"), b"x").expect("write clip");

        let result = collect_media_paths(&[as_string(root.clone())]);

        let expected = vec![
            as_string(root.join("nested").join("clip.mp4")),
            as_string(root.join("song.mp3")),
        ];
        cleanup(&root);
        assert_eq!(result, expected);
    }
}
