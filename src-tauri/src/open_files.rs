use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Emitter};

/// Wakes the frontend up to drain the queue. The payload is empty on purpose:
/// the queue holds the paths, so a cold start (frontend not listening yet) and a
/// warm start (single-instance forward, macOS open event) share one code path
/// and cannot deliver a file twice.
pub const OPEN_PATHS_EVENT: &str = "app://open-paths";

/// Paths waiting for the frontend, drained by `take_pending_open_paths`. A
/// process-wide static (not managed state) because the single-instance callback
/// can fire before builder state is managed.
static PENDING: LazyLock<Mutex<Vec<String>>> = LazyLock::new(|| Mutex::new(Vec::new()));

/// Paths named on the command line: `argv[0]` is the executable, and a switch
/// (`-x` / `--flag`) is never a file the user asked to open.
pub fn paths_from_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .map(|arg| arg.as_ref().to_owned())
        .filter(|arg| !arg.starts_with('-'))
        .collect()
}

/// Queue the raw paths (files or folders, expanded and filtered like a drop) and
/// poke the frontend. An empty expansion is a no-op, so a bare launch never
/// replaces the current playlist with nothing.
pub fn deliver(app: &AppHandle, raw: Vec<String>) {
    log::info!("open_files: deliver raw_args={}", raw.len());
    let paths = crate::import::collect_media_paths(&raw);
    if paths.is_empty() {
        log::warn!("open_files: deliver ignored, no media paths in the request");
        return;
    }
    log::info!("open_files: queued paths={}", paths.len());
    PENDING.lock().expect("open paths lock").extend(paths);
    let _ = app.emit(OPEN_PATHS_EVENT, ());
}

#[tauri::command]
pub fn take_pending_open_paths() -> Vec<String> {
    let paths = std::mem::take(&mut *PENDING.lock().expect("open paths lock"));
    log::info!("open_files: drained pending paths={}", paths.len());
    paths
}

#[cfg(test)]
mod tests {
    use super::paths_from_args;

    #[test]
    fn should_drop_the_executable_from_argv() {
        let paths = paths_from_args(["C:\\apps\\pureplayer.exe", "C:\\v\\a.mkv"]);
        assert_eq!(paths, vec!["C:\\v\\a.mkv".to_string()]);
    }

    #[test]
    fn should_keep_every_file_when_several_are_passed() {
        let paths = paths_from_args(["/usr/bin/pureplayer", "a.mp4", "b.mp3"]);
        assert_eq!(paths, vec!["a.mp4".to_string(), "b.mp3".to_string()]);
    }

    #[test]
    fn should_ignore_switches() {
        let paths = paths_from_args(["pureplayer", "--no-sandbox", "/v/a.mp4", "-v"]);
        assert_eq!(paths, vec!["/v/a.mp4".to_string()]);
    }

    #[test]
    fn should_return_no_paths_for_a_bare_launch() {
        assert!(paths_from_args(["pureplayer"]).is_empty());
    }
}
