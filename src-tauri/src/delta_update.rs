//! Incremental (delta) updates.
//!
//! The updater artifacts are large mostly because of the ffmpeg/ffprobe sidecars,
//! which rarely change. CI publishes a bsdiff patch from the previous release's
//! artifact and `deltas.json` next to `latest.json`; here the app applies that
//! patch to a cached copy of the artifact it is running from. The reconstructed
//! artifact is checked against the manifest hash and the minisign signature from
//! `latest.json` before the Tauri installer sees it. Every miss (no cache, no
//! patch entry, bad hash, bad signature) falls back to the full download.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// Published next to `latest.json` on every release.
pub const MANIFEST_FILE: &str = "deltas.json";
/// Byte progress for the update toast/UI.
pub const EVENT_PROGRESS: &str = "update-progress";
const ARTIFACT_FILE: &str = "artifact.bin";
const VERSION_FILE: &str = "version";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeltaPatch {
    /// `{{target}}` value the updater reports (`windows-x86_64`, `darwin-aarch64`, ...).
    pub target: String,
    pub from_version: String,
    pub to_version: String,
    /// Patch file name; it sits in the same release as the manifest.
    pub file: String,
    /// sha256 of the patch file itself.
    pub sha256: String,
    /// sha256 of the artifact the patch reconstructs.
    pub artifact_sha256: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeltaManifest {
    /// Version the manifest belongs to; a manifest for another version is ignored.
    pub version: String,
    pub patches: Vec<DeltaPatch>,
}

impl DeltaManifest {
    pub fn from_json(bytes: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(bytes).map_err(|e| format!("invalid {MANIFEST_FILE}: {e}"))
    }

    pub fn find(&self, target: &str, from_version: &str, to_version: &str) -> Option<&DeltaPatch> {
        self.patches.iter().find(|p| {
            p.target == target
                && p.from_version == from_version
                && p.to_version == to_version
        })
    }
}

/// One cached artifact for the version the app currently runs from.
pub struct CacheLayout {
    dir: PathBuf,
}

impl CacheLayout {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Cached bytes, but only if they belong to `version`.
    pub fn base(&self, version: &str) -> Option<Vec<u8>> {
        let recorded = std::fs::read_to_string(self.dir.join(VERSION_FILE)).ok()?;
        if recorded.trim() != version.trim() {
            return None;
        }
        std::fs::read(self.dir.join(ARTIFACT_FILE)).ok()
    }

    /// Replace the cache. The version marker is dropped first, so a crash
    /// mid-write leaves a cache miss rather than a stale match.
    pub fn store(&self, version: &str, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let version_path = self.dir.join(VERSION_FILE);
        let _ = std::fs::remove_file(&version_path);
        std::fs::write(self.dir.join(ARTIFACT_FILE), bytes)?;
        std::fs::write(version_path, version.trim())
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Apply a bsdiff patch produced by `patchgen` (`qbsdiff::Bsdiff`).
pub fn apply_patch(base: &[u8], patch: &[u8]) -> Result<Vec<u8>, String> {
    let patcher = qbsdiff::Bspatch::new(patch).map_err(|e| format!("unreadable patch: {e}"))?;
    let mut target = Vec::new();
    patcher
        .apply(base, std::io::Cursor::new(&mut target))
        .map_err(|e| format!("patch does not apply: {e}"))?;
    Ok(target)
}

/// Replace the last path segment of a release asset URL: the manifest and the
/// patches live beside the artifact `latest.json` points at.
pub fn sibling_url(download_url: &str, name: &str) -> String {
    match download_url.rfind('/') {
        Some(index) => format!("{}/{}", &download_url[..index], name),
        None => name.to_string(),
    }
}

/// Mirror of the updater plugin's own check: base64(armored key/signature).
pub fn verify_artifact(bytes: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    let key_text = decode_base64_text(pubkey)?;
    let public_key = minisign_verify::PublicKey::decode(&key_text)
        .map_err(|e| format!("invalid updater public key: {e}"))?;
    let signature_text = decode_base64_text(signature)?;
    let parsed = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| format!("invalid update signature: {e}"))?;
    public_key
        .verify(bytes, &parsed, true)
        .map_err(|e| format!("update signature does not match the artifact: {e}"))
}

fn decode_base64_text(encoded: &str) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let raw = STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    String::from_utf8(raw).map_err(|e| format!("invalid utf-8: {e}"))
}

// ---------------------------------------------------------------------------
// Runtime: the two commands the frontend controller drives.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateSummary {
    pub version: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn emit_progress(app: &tauri::AppHandle, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(EVENT_PROGRESS, UpdateProgress { downloaded, total });
}

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("updates"))
        .map_err(|error| format!("no app data directory: {error}"))
}

fn updater_pubkey(app: &tauri::AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
        .ok_or_else(|| "no `plugins.updater.pubkey` in the app config".to_string())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("pureplayer-updater")
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("http client: {error}"))
}

/// Check only: the install command re-checks, so nothing has to be kept between
/// the two calls (and a stale offer cannot install a newer version silently).
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<UpdateSummary>, String> {
    log::info!("update: checking for a new version");
    let update = app
        .updater()
        .map_err(|error| format!("updater unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("update check failed: {error}"))?;
    let summary = update.map(|update| UpdateSummary {
        version: update.version,
    });
    match &summary {
        Some(summary) => log::info!("update: version {} available", summary.version),
        None => log::info!("update: running the latest version"),
    }
    Ok(summary)
}

/// Delta when possible, full artifact otherwise; then install and let the
/// frontend relaunch (the Windows installer exits the process itself).
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|error| format!("updater unavailable: {error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("update check failed: {error}"))?
        .ok_or_else(|| "no update available".to_string())?;

    let cache = CacheLayout::new(cache_dir(&app)?);
    let bytes = match try_delta(&app, &update, &cache).await {
        Ok(Some(bytes)) => bytes,
        Ok(None) => full_download(&app, &update).await?,
        Err(error) => {
            log::warn!("delta update unavailable ({error}); downloading the full artifact");
            full_download(&app, &update).await?
        }
    };

    // Best effort: the cache only buys a patch for the NEXT update, so a write
    // failure must never stop this one.
    if let Err(error) = cache.store(&update.version, &bytes) {
        log::warn!("could not cache the update artifact: {error}");
    }

    log::info!(
        "installing pureplayer {} ({} bytes)",
        update.version,
        bytes.len()
    );
    update.install(bytes).map_err(|error| {
        log::error!("update: install failed: {error}");
        format!("install failed: {error}")
    })
}

/// `Ok(None)` means "no delta applies, take the full artifact"; `Err` means the
/// delta was attempted and failed validation (also a full download, logged).
async fn try_delta(
    app: &tauri::AppHandle,
    update: &tauri_plugin_updater::Update,
    cache: &CacheLayout,
) -> Result<Option<Vec<u8>>, String> {
    let Some(base) = cache.base(&update.current_version) else {
        log::info!(
            "no cached artifact for {}; skipping the delta path",
            update.current_version
        );
        return Ok(None);
    };

    let client = http_client()?;
    let manifest_url = sibling_url(update.download_url.as_str(), MANIFEST_FILE);
    let response = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|error| format!("{manifest_url} is unreachable: {error}"))?;
    if !response.status().is_success() {
        log::info!(
            "no {MANIFEST_FILE} at {manifest_url} ({}); skipping the delta path",
            response.status()
        );
        return Ok(None);
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("unreadable {MANIFEST_FILE}: {error}"))?;
    let manifest = DeltaManifest::from_json(&body)?;
    if manifest.version != update.version {
        log::info!(
            "{MANIFEST_FILE} is for {}, not {}; skipping the delta path",
            manifest.version,
            update.version
        );
        return Ok(None);
    }

    let Some(entry) = manifest
        .find(&update.target, &update.current_version, &update.version)
        .cloned()
    else {
        log::info!(
            "no patch {} -> {} for {}; skipping the delta path",
            update.current_version,
            update.version,
            update.target
        );
        return Ok(None);
    };

    let patch_url = sibling_url(update.download_url.as_str(), &entry.file);
    let patch = download_bytes(app, &client, &patch_url).await?;
    if sha256_hex(&patch) != entry.sha256 {
        return Err(format!("{patch_url} does not match the manifest hash"));
    }

    let patch_len = patch.len();
    let patched = tauri::async_runtime::spawn_blocking(move || apply_patch(&base, &patch))
        .await
        .map_err(|error| format!("patch task failed: {error}"))??;
    if sha256_hex(&patched) != entry.artifact_sha256 {
        return Err(format!(
            "patched artifact does not match {} from the manifest",
            entry.artifact_sha256
        ));
    }
    verify_artifact(&patched, &update.signature, &updater_pubkey(app)?)?;

    log::info!(
        "delta update: {patch_len} byte patch -> {} byte artifact ({} -> {})",
        patched.len(),
        update.current_version,
        update.version
    );
    Ok(Some(patched))
}

async fn download_bytes(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{url} is unreachable: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} returned {}", response.status()));
    }

    let total = response.content_length();
    let mut downloaded = 0u64;
    let mut bytes = Vec::with_capacity(total.unwrap_or(0) as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("{url} download failed: {error}"))?
    {
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        emit_progress(app, downloaded, total);
    }
    Ok(bytes)
}

async fn full_download(
    app: &tauri::AppHandle,
    update: &tauri_plugin_updater::Update,
) -> Result<Vec<u8>, String> {
    let mut downloaded = 0u64;
    // The plugin verifies the minisign signature of the bytes it returns.
    let bytes = update
        .download(
            |chunk_len, total| {
                downloaded += chunk_len as u64;
                emit_progress(app, downloaded, total);
            },
            || {},
        )
        .await
        .map_err(|error| format!("download failed: {error}"))?;
    log::info!("full update artifact downloaded: {} bytes", bytes.len());
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
      "version": "0.4.0",
      "patches": [
        {
          "target": "windows-x86_64",
          "from_version": "0.3.0",
          "to_version": "0.4.0",
          "file": "pureplayer_0.3.0_x64-setup.nsis.zip.from-0.3.0.patch",
          "sha256": "aa",
          "artifact_sha256": "bb"
        }
      ]
    }"#;

    fn cache_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    #[test]
    fn should_find_patch_for_matching_target_and_versions() {
        let manifest = DeltaManifest::from_json(MANIFEST.as_bytes()).expect("parses");
        let patch = manifest
            .find("windows-x86_64", "0.3.0", "0.4.0")
            .expect("patch found");
        assert_eq!(patch.file, "pureplayer_0.3.0_x64-setup.nsis.zip.from-0.3.0.patch");
    }

    #[test]
    fn should_return_none_if_target_differs() {
        let manifest = DeltaManifest::from_json(MANIFEST.as_bytes()).expect("parses");
        assert!(manifest.find("darwin-aarch64", "0.3.0", "0.4.0").is_none());
    }

    #[test]
    fn should_return_none_if_from_version_differs() {
        let manifest = DeltaManifest::from_json(MANIFEST.as_bytes()).expect("parses");
        assert!(manifest.find("windows-x86_64", "0.2.0", "0.4.0").is_none());
    }

    #[test]
    fn should_return_none_if_to_version_differs() {
        let manifest = DeltaManifest::from_json(MANIFEST.as_bytes()).expect("parses");
        assert!(manifest.find("windows-x86_64", "0.3.0", "0.5.0").is_none());
    }

    #[test]
    fn should_reject_manifest_that_is_not_json() {
        assert!(DeltaManifest::from_json(b"not json").is_err());
    }

    #[test]
    fn should_patch_old_artifact_into_new_artifact() {
        let base = vec![7u8; 4096];
        let mut target = base.clone();
        target.extend_from_slice(b"a changed tail");
        let mut patch = Vec::new();
        qbsdiff::Bsdiff::new(&base, &target)
            .compare(std::io::Cursor::new(&mut patch))
            .expect("patch generated");

        let patched = apply_patch(&base, &patch).expect("patch applies");

        assert_eq!(patched, target);
    }

    #[test]
    fn should_fail_to_patch_with_garbage() {
        assert!(apply_patch(b"base", b"not a patch").is_err());
    }

    #[test]
    fn should_hash_bytes_with_sha256() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn should_point_sibling_url_at_manifest_and_patch() {
        let url = "https://github.com/o/r/releases/latest/download/latest.json";
        assert_eq!(
            sibling_url(url, MANIFEST_FILE),
            "https://github.com/o/r/releases/latest/download/deltas.json"
        );
        assert_eq!(
            sibling_url(url, "x.patch"),
            "https://github.com/o/r/releases/latest/download/x.patch"
        );
    }

    #[test]
    fn should_reject_signature_that_is_not_minisign() {
        assert!(verify_artifact(b"bytes", "bm90IGEgc2ln", "bm90IGEga2V5").is_err());
    }

    #[test]
    fn should_return_cached_bytes_only_for_the_recorded_version() {
        let dir = cache_dir();
        let cache = CacheLayout::new(dir.path());
        assert!(cache.base("0.3.0").is_none(), "empty cache is a miss");

        cache.store("0.3.0", b"artifact").expect("stored");
        assert_eq!(cache.base("0.3.0").as_deref(), Some(&b"artifact"[..]));
        assert!(cache.base("0.4.0").is_none(), "other version is a miss");
    }

    #[test]
    fn should_replace_cached_artifact_on_store() {
        let dir = cache_dir();
        let cache = CacheLayout::new(dir.path());
        cache.store("0.3.0", b"old").expect("stored");
        cache.store("0.4.0", b"new").expect("stored");

        assert_eq!(cache.base("0.4.0").as_deref(), Some(&b"new"[..]));
        assert!(cache.base("0.3.0").is_none());
    }
}
