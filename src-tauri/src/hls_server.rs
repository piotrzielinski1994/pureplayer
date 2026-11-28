use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use tiny_http::{Header, Response, Server, StatusCode};

// hls.js (used on Chromium webviews, which have no native HLS) fetches the playlist
// and segments from the app origin, so this loopback server is always cross-origin
// and must say so on every response - including the 404 for a segment that ffmpeg
// has not written yet, otherwise the fetch fails as a CORS error instead of a
// retryable not-found.
const CORS_ORIGIN: &str = "Access-Control-Allow-Origin: *";

fn cors_header() -> Header {
    let (name, value) = CORS_ORIGIN.split_once(": ").expect("static header");
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header is valid")
}

// Web-compatible MIME for the two HLS file kinds WKWebView's native player fetches.
// Unknown names fall back to a generic binary type rather than guessing.
fn hls_mime(filename: &str) -> &'static str {
    if filename.ends_with(".m3u8") {
        return "application/vnd.apple.mpegurl";
    }
    if filename.ends_with(".ts") {
        return "video/mp2t";
    }
    "application/octet-stream"
}

// Map an HTTP request path to a real file INSIDE root, or None. Security-critical:
// any non-normal component (`..`, a root/prefix segment) is rejected outright, and
// the final path must canonicalize to something still under root - so a request can
// never escape the served directory.
fn resolve_under_root(root: &Path, url_path: &str) -> Option<PathBuf> {
    let relative = url_path.trim_start_matches('/');
    if relative.is_empty() {
        return None;
    }
    let is_unsafe = Path::new(relative)
        .components()
        .any(|component| !matches!(component, Component::Normal(_)));
    if is_unsafe {
        return None;
    }
    let root_real = std::fs::canonicalize(root).ok()?;
    let candidate = std::fs::canonicalize(root_real.join(relative)).ok()?;
    candidate.starts_with(&root_real).then_some(candidate)
}

// A source file kept open for the whole playback session. Paths are useless once
// the user deletes the file: the asset protocol opens the path afresh on every
// byte-range request, so the next request fails and playback dies. An open handle
// survives the delete (both POSIX and Windows keep the data reachable through it),
// which is how VLC plays a deleted file to the end.
pub struct HeldFile {
    file: File,
    len: u64,
    mime: &'static str,
}

// The handles the loopback server may serve, keyed by an unguessable-enough token
// carried in the URL. Only one video plays at a time, so the registry is cleared
// on every new activation - dropping the handles also releases a deleted file.
#[derive(Clone, Default)]
pub struct HeldFiles(Arc<Mutex<HashMap<String, Arc<HeldFile>>>>);

impl HeldFiles {
    pub fn new() -> Self {
        Self::default()
    }

    // Register `file` under `token`, keeping the open handle alive. `path` is used
    // only for its extension (the Content-Type) and length.
    pub fn insert(&self, token: &str, file: File, path: &Path) -> std::io::Result<u64> {
        let len = file.metadata()?.len();
        let mime = media_mime(path);
        let held = Arc::new(HeldFile { file, len, mime });
        if let Ok(mut held_files) = self.0.lock() {
            held_files.insert(token.to_string(), held);
        }
        log::info!("hls: holding file open token={token} bytes={len} mime={mime} path={path:?}");
        Ok(len)
    }

    pub fn clear(&self) {
        if let Ok(mut held_files) = self.0.lock() {
            log::debug!("hls: dropping {} held file(s)", held_files.len());
            held_files.clear();
        }
    }

    fn get(&self, token: &str) -> Option<Arc<HeldFile>> {
        self.0.lock().ok()?.get(token).cloned()
    }
}

// Content-Type for the files served from a held handle. A media element needs a
// real media type here; anything unrecognised falls back to a generic binary type.
fn media_mime(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

// Parse one `Range: bytes=start-end` header against a file of `len` bytes. Returns
// an INCLUSIVE (start, end) pair, clamped to the file; None means "serve the whole
// file" (no header, a multi-range or malformed header). A media element seeks by
// asking for a slice, so this is what keeps native seeking working.
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start_part, end_part) = spec.split_once('-')?;
    let (start_part, end_part) = (start_part.trim(), end_part.trim());
    if start_part.is_empty() {
        // Suffix form: the LAST n bytes.
        let suffix: u64 = end_part.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len - 1));
    }
    let start: u64 = start_part.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if end_part.is_empty() {
        len - 1
    } else {
        end_part.parse::<u64>().ok()?.min(len - 1)
    };
    (end >= start).then_some((start, end))
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("dynamically built header is valid")
}

// Serve one byte range (or the whole file) out of an already-open handle. The
// handle is duplicated per request, so concurrent requests can't fight over the
// read position and none of them touch the path.
fn serve_held(request: tiny_http::Request, held: &HeldFile) {
    log::debug!("hls: serve held url={}", request.url());
    let range = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Range"))
        .and_then(|header| parse_range(header.value.as_str(), held.len));
    let Ok(mut file) = held.file.try_clone() else {
        log::warn!("hls: could not clone the held handle for {}", request.url());
        let _ = request.respond(Response::empty(404).with_header(cors_header()));
        return;
    };
    let (status, start, length) = match range {
        Some((start, end)) => (206, start, end - start + 1),
        None => (200, 0, held.len),
    };
    if file.seek(SeekFrom::Start(start)).is_err() {
        log::warn!("hls: seek to {start} failed for {}", request.url());
        let _ = request.respond(Response::empty(404).with_header(cors_header()));
        return;
    }
    let mut headers = vec![
        header("Content-Type", held.mime),
        header("Accept-Ranges", "bytes"),
        cors_header(),
    ];
    if status == 206 {
        headers.push(header(
            "Content-Range",
            &format!("bytes {}-{}/{}", start, start + length - 1, held.len),
        ));
    }
    let body: Box<dyn Read + Send> = Box::new(file.take(length));
    let _ = request.respond(Response::new(
        StatusCode(status),
        headers,
        body,
        Some(length as usize),
        None,
    ));
}

fn respond(request: tiny_http::Request, root: &Path, held_files: &HeldFiles) {
    let url_path = request.url().split('?').next().unwrap_or("").to_string();
    if let Some(token) = url_path.strip_prefix("/f/") {
        match held_files.get(token) {
            Some(held) => serve_held(request, &held),
            None => {
                log::warn!("hls: unknown held token url={url_path}");
                let _ = request.respond(Response::empty(404).with_header(cors_header()));
            }
        }
        return;
    }
    let Some(path) = resolve_under_root(root, &url_path) else {
        log::warn!("hls: refused url outside the served root url={url_path}");
        let _ = request.respond(Response::empty(404).with_header(cors_header()));
        return;
    };
    let Ok(file) = std::fs::File::open(&path) else {
        log::debug!("hls: not written yet url={url_path}");
        let _ = request.respond(Response::empty(404).with_header(cors_header()));
        return;
    };
    let mime = hls_mime(&path.file_name().unwrap_or_default().to_string_lossy());
    let header = Header::from_bytes(b"Content-Type".as_slice(), mime.as_bytes())
        .expect("static mime header is valid");
    let _ = request
        .respond(Response::from_file(file).with_header(header).with_header(cors_header()));
}

// Loopback-only HTTP server. Binds 127.0.0.1:0 (OS-assigned port) so it is never
// reachable off-machine. Serves two things: files under `root` (HLS segments; the
// only path-derived serving left, since segments are written by ffmpeg into temp)
// and the held passthrough handles at `/f/<token>`. Returns the chosen port; the
// worker thread runs for the app's lifetime.
pub fn start(
    root: PathBuf,
    held_files: HeldFiles,
) -> std::io::Result<(u16, JoinHandle<()>)> {
    let server = Server::http("127.0.0.1:0").map_err(std::io::Error::other)?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let handle = std::thread::spawn(move || {
        for request in server.incoming_requests() {
            // One thread per request: a held source can be a multi-GB body streamed
            // for minutes, and the player opens a second connection to read another
            // range (a seek, the tail probe). Handling requests inline would stall
            // that second request behind the first.
            let root = root.clone();
            let held_files = held_files.clone();
            std::thread::spawn(move || respond(request, &root, &held_files));
        }
    });
    Ok((port, handle))
}

#[cfg(test)]
mod tests {
    use super::{hls_mime, parse_range, resolve_under_root, start, HeldFiles};
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::ops::Deref;
    use std::path::{Path, PathBuf};

    // A unique tempdir that removes itself on drop, so tests don't leave a trail of
    // `pureplayer-hls-test-*` dirs in the OS temp dir. Derefs to Path, so call sites use
    // it like a path. Created on disk so canonicalize-based checks have a real root.
    struct TempRoot(PathBuf);

    impl Deref for TempRoot {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl AsRef<Path> for TempRoot {
        fn as_ref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn unique_root() -> TempRoot {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut dir = std::env::temp_dir();
        dir.push(format!("pureplayer-hls-test-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create test root");
        TempRoot(dir)
    }

    // AC-001: .m3u8 -> the HLS playlist MIME
    #[test]
    fn should_return_mpegurl_mime_when_name_ends_with_m3u8() {
        assert_eq!(hls_mime("index.m3u8"), "application/vnd.apple.mpegurl");
    }

    // AC-001: .ts -> the MPEG-TS segment MIME
    #[test]
    fn should_return_mp2t_mime_when_name_ends_with_ts() {
        assert_eq!(hls_mime("seg00001.ts"), "video/mp2t");
    }

    // AC-001: an unrecognised extension falls back to the generic binary MIME
    #[test]
    fn should_return_octet_stream_mime_when_extension_is_unknown() {
        assert_eq!(hls_mime("foo.bar"), "application/octet-stream");
    }

    // AC-001: a name with no extension also falls back to the generic binary MIME
    #[test]
    fn should_return_octet_stream_mime_when_name_has_no_extension() {
        assert_eq!(hls_mime("README"), "application/octet-stream");
    }

    // AC-004: a plain file directly under root resolves to a path inside root
    #[test]
    fn should_resolve_to_path_under_root_when_file_is_directly_under_root() {
        let root = unique_root();
        std::fs::write(root.join("index.m3u8"), b"#EXTM3U").expect("write file");
        let resolved = resolve_under_root(&root, "/index.m3u8").expect("should resolve");
        let root_real = std::fs::canonicalize(&root).expect("canonicalize root");
        assert!(
            resolved.starts_with(&root_real),
            "{resolved:?} should start with {root_real:?}"
        );
    }

    // AC-004: a nested file under root resolves to a path inside root
    #[test]
    fn should_resolve_to_path_under_root_when_file_is_nested_under_root() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("job1")).expect("create nested dir");
        std::fs::write(root.join("job1/index.m3u8"), b"#EXTM3U").expect("write file");
        let resolved = resolve_under_root(&root, "/job1/index.m3u8").expect("should resolve");
        let root_real = std::fs::canonicalize(&root).expect("canonicalize root");
        assert!(
            resolved.starts_with(&root_real),
            "{resolved:?} should start with {root_real:?}"
        );
    }

    // AC-004: a leading-`..` traversal escaping root is rejected
    #[test]
    fn should_reject_when_url_path_traverses_above_root() {
        let root = unique_root();
        assert_eq!(resolve_under_root(&root, "../../etc/passwd"), None);
    }

    // AC-004: an embedded `..` that climbs out of root is rejected
    #[test]
    fn should_reject_when_url_path_embeds_traversal_escaping_root() {
        let root = unique_root();
        assert_eq!(resolve_under_root(&root, "job1/../../../etc/passwd"), None);
    }

    // AC-004: an absolute path pointing outside root is rejected
    #[test]
    fn should_reject_when_url_path_is_absolute_outside_root() {
        let root = unique_root();
        assert_eq!(resolve_under_root(&root, "/etc/passwd"), None);
    }

    // AC-004: an empty url path targets no file
    #[test]
    fn should_reject_when_url_path_is_empty() {
        let root = unique_root();
        assert_eq!(resolve_under_root(&root, ""), None);
    }

    // AC-004: a bare "/" targets no file
    #[test]
    fn should_reject_when_url_path_is_only_root_slash() {
        let root = unique_root();
        assert_eq!(resolve_under_root(&root, "/"), None);
    }

    fn http_get(port: u16, path: &str) -> String {
        http_get_with(port, path, "")
    }

    fn http_get_with(port: u16, path: &str, extra_headers: &str) -> String {
        let mut stream =
            TcpStream::connect(("127.0.0.1", port)).expect("connect to loopback server");
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{extra_headers}\r\n"
        )
        .expect("write request");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read response");
        response
    }

    // AC-001: a registered handle keeps serving its bytes after the source path is
    // gone - the whole point of holding it open (VLC survives a delete, a
    // per-request re-open does not).
    #[test]
    fn should_serve_held_file_after_source_is_deleted() {
        let root = unique_root();
        let path = root.join("clip.mp4");
        std::fs::write(&path, b"0123456789").expect("write source");
        let held = HeldFiles::new();
        let file = std::fs::File::open(&path).expect("open source");
        held.insert("tok1", file, &path).expect("register handle");
        std::fs::remove_file(&path).expect("delete source");
        let (port, _server) = start(root.to_path_buf(), held).expect("start server");

        let response = http_get(port, "/f/tok1");
        assert!(response.contains("200 OK"), "expected 200, got: {response}");
        assert!(
            response.ends_with("0123456789"),
            "expected the full body, got: {response}"
        );
        assert!(
            response.contains("Accept-Ranges: bytes"),
            "expected range support, got: {response}"
        );
    }

    // AC-002: a media element reads a held file by byte ranges, so `<video>` can seek.
    #[test]
    fn should_serve_requested_byte_range_when_range_header_present() {
        let root = unique_root();
        let path = root.join("clip.mp4");
        std::fs::write(&path, b"0123456789").expect("write source");
        let held = HeldFiles::new();
        let file = std::fs::File::open(&path).expect("open source");
        held.insert("tok2", file, &path).expect("register handle");
        let (port, _server) = start(root.to_path_buf(), held).expect("start server");

        let response = http_get_with(port, "/f/tok2", "Range: bytes=2-5\r\n");
        assert!(response.contains("206"), "expected 206, got: {response}");
        assert!(
            response.contains("Content-Range: bytes 2-5/10"),
            "expected the slice, got: {response}"
        );
        assert!(response.ends_with("2345"), "expected slice body, got: {response}");
    }

    // AC-002: the served Content-Type comes from the file extension, so a browser
    // treats the bytes as media rather than an opaque download.
    #[test]
    fn should_serve_media_content_type_for_a_held_file() {
        let root = unique_root();
        let path = root.join("clip.webm");
        std::fs::write(&path, b"webm-bytes").expect("write source");
        let held = HeldFiles::new();
        let file = std::fs::File::open(&path).expect("open source");
        held.insert("tok3", file, &path).expect("register handle");
        let (port, _server) = start(root.to_path_buf(), held).expect("start server");

        let response = http_get(port, "/f/tok3");
        assert!(
            response.contains("Content-Type: video/webm"),
            "expected the webm mime, got: {response}"
        );
    }

    // AC-003: an unknown token is a not-found, not a file-system fallback.
    #[test]
    fn should_return_404_when_held_token_is_unknown() {
        let root = unique_root();
        std::fs::write(root.join("index.m3u8"), b"#EXTM3U\n").expect("write playlist");
        let (port, _server) = start(root.to_path_buf(), HeldFiles::new()).expect("start server");

        let response = http_get(port, "/f/nope");
        assert!(response.contains("404"), "expected 404, got: {response}");
    }

    // AC-002: an open-ended range runs to the end of the file
    #[test]
    fn should_run_to_end_of_file_when_range_has_no_end() {
        assert_eq!(parse_range("bytes=3-", 10), Some((3, 9)));
    }

    // AC-002: a suffix range asks for the LAST n bytes (players probe the tail for
    // the moov atom this way)
    #[test]
    fn should_serve_last_bytes_when_range_is_a_suffix() {
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
    }

    // AC-002: an end past EOF is clamped, not rejected
    #[test]
    fn should_clamp_range_end_when_it_exceeds_file_length() {
        assert_eq!(parse_range("bytes=8-100", 10), Some((8, 9)));
    }

    // AC-002: a multi-range request is not supported - serve the whole file instead
    #[test]
    fn should_ignore_range_when_multiple_ranges_are_requested() {
        assert_eq!(parse_range("bytes=0-1,4-5", 10), None);
    }

    // AC-002: a garbage range header falls back to the whole file
    #[test]
    fn should_ignore_range_when_header_is_not_a_byte_range() {
        assert_eq!(parse_range("items=0-1", 10), None);
    }

    // AC-001: the running server serves a real playlist file with the HLS MIME
    #[test]
    fn should_serve_m3u8_with_hls_mime_when_file_exists() {
        let root = unique_root();
        std::fs::write(root.join("index.m3u8"), b"#EXTM3U\n").expect("write playlist");
        let (port, _server) = start(root.to_path_buf(), HeldFiles::new()).expect("start server");
        let response = http_get(port, "/index.m3u8");
        assert!(response.contains("200 OK"), "expected 200, got: {response}");
        assert!(
            response.contains("application/vnd.apple.mpegurl"),
            "expected HLS mime, got: {response}"
        );
        assert!(
            response.contains("#EXTM3U"),
            "expected body, got: {response}"
        );
    }

    // hls.js fetches the playlist cross-origin (app origin -> 127.0.0.1), so every
    // response needs an explicit CORS allow, not just the 200 ones.
    #[test]
    fn should_allow_cross_origin_reads_when_serving_a_playlist() {
        let root = unique_root();
        std::fs::write(root.join("index.m3u8"), b"#EXTM3U\n").expect("write playlist");
        let (port, _server) = start(root.to_path_buf(), HeldFiles::new()).expect("start server");
        let response = http_get(port, "/index.m3u8");
        assert!(
            response.contains("Access-Control-Allow-Origin: *"),
            "expected CORS header, got: {response}"
        );
    }

    #[test]
    fn should_allow_cross_origin_reads_when_segment_is_not_written_yet() {
        let root = unique_root();
        let (port, _server) = start(root.to_path_buf(), HeldFiles::new()).expect("start server");
        let response = http_get(port, "/1/seg00009.ts");
        assert!(response.contains("404"), "expected 404, got: {response}");
        assert!(
            response.contains("Access-Control-Allow-Origin: *"),
            "expected CORS header on 404, got: {response}"
        );
    }

    // AC-004: a traversal request to the running server is refused, not served
    #[test]
    fn should_return_404_when_request_escapes_root() {
        let root = unique_root();
        let (port, _server) = start(root.to_path_buf(), HeldFiles::new()).expect("start server");
        let response = http_get(port, "/../../etc/passwd");
        assert!(response.contains("404"), "expected 404, got: {response}");
    }
}
