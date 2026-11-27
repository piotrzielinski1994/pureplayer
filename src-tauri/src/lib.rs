mod delta_update;
mod focus;
mod hls_server;
mod import;
mod logging;
mod media;
mod open_files;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Greetings from Tauri.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // First, so a second launch (Explorer "Open with", double-clicked file)
        // forwards its argv to the running window instead of opening a new one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_files::deliver(app, open_files::paths_from_args(argv));
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_libmpv::init())
        .setup(|app| {
            logging::init(app.handle());
            // Files named on this launch's command line (file association).
            open_files::deliver(
                app.handle(),
                open_files::paths_from_args(std::env::args()),
            );
            // Fresh temp roots each launch (wipe any leftovers): one for the rare
            // HLS re-encode stream, one for the complete-MP4 remuxes that back the
            // common copy path. Then start the loopback server for the HLS player.
            let hls_root = std::env::temp_dir().join("pureplayer-hls");
            let remux_root = std::env::temp_dir().join("pureplayer-remux");
            for root in [&hls_root, &remux_root] {
                let _ = std::fs::remove_dir_all(root);
                std::fs::create_dir_all(root)?;
            }
            // The same server also serves the passthrough source from a handle kept
            // open for the session, so deleting the file mid-playback doesn't stop it.
            let files = hls_server::HeldFiles::new();
            let (port, _server) = hls_server::start(hls_root.clone(), files.clone())?;
            log::info!("HLS server listening on 127.0.0.1:{port} root={hls_root:?}");
            app.manage(media::MediaState {
                hls_root,
                remux_root,
                port,
                files,
                current_hls: std::sync::Mutex::new(None),
                current_bg: std::sync::Mutex::new(None),
            });
            // Warm the ffmpeg/ffprobe sidecars now (behind the empty UI) so the
            // first dropped file doesn't pay their cold first-spawn cost. The
            // Windows build ships libmpv instead and has no sidecars.
            #[cfg(not(windows))]
            media::prewarm_sidecars(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            media::prepare_media,
            media::seek_media,
            media::log_playback,
            focus::focus_webview,
            import::expand_dropped_paths,
            open_files::take_pending_open_paths,
            delta_update::update_check,
            delta_update::update_install
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // macOS delivers a double-clicked file as an "open document" event, not
        // as argv, so it needs its own path into the queue.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            open_files::deliver(app, paths);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn should_greet_with_name_when_given_one() {
        assert_eq!(greet("World"), "Hello, World! Greetings from Tauri.");
    }

    #[test]
    fn should_greet_with_empty_name_when_name_is_blank() {
        assert_eq!(greet(""), "Hello, ! Greetings from Tauri.");
    }
}
