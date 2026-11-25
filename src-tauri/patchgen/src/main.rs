//! Generates the delta artifacts a release publishes next to `latest.json`:
//! one bsdiff patch per updater artifact of the previous release, plus
//! `deltas.json` describing them. Run by the `Release` workflow:
//!
//! ```text
//! patchgen --old <previous-release-assets> --new <bundle-dir> --out <deltas-dir>
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const MANIFEST_FILE: &str = "deltas.json";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct DeltaPatch {
    target: String,
    from_version: String,
    to_version: String,
    file: String,
    sha256: String,
    artifact_sha256: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct DeltaManifest {
    version: String,
    patches: Vec<DeltaPatch>,
}

/// `pureplayer_0.3.0_x64-setup.nsis.zip` -> ("0.3.0", "x64-setup.nsis.zip").
/// The middle segment that looks like a version is the one that changes between
/// releases; everything else identifies the artifact kind.
fn split_release_name(name: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = name.split('_').collect();
    let index = parts.iter().position(|part| looks_like_version(part))?;
    // Both a product prefix and an artifact kind have to exist, otherwise the
    // segment is not a version in a release file name.
    if index == 0 || index + 1 >= parts.len() {
        return None;
    }
    Some((
        parts[index].to_string(),
        parts[index + 1..].join("_"),
    ))
}

/// `0.3.0`, `0.3.0-beta.1`, `1.2.3+build`. Not `x64-setup.nsis.zip`.
fn looks_like_version(part: &str) -> bool {
    let core = part.split(['-', '+']).next().unwrap_or(part);
    let mut pieces = core.split('.');
    let numeric_prefix = (0..3).all(|_| {
        pieces
            .next()
            .map(|piece| !piece.is_empty() && piece.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
    });
    numeric_prefix && pieces.next().is_none()
}

/// Updater `{{target}}` values an artifact kind is downloaded for. macOS builds
/// are universal, so one artifact serves both architectures.
fn targets_for(rest: &str) -> Vec<&'static str> {
    if rest.ends_with("x64-setup.nsis.zip") {
        vec!["windows-x86_64"]
    } else if rest.ends_with("amd64.AppImage.tar.gz") {
        vec!["linux-x86_64"]
    } else if rest.ends_with("universal.app.tar.gz") {
        vec!["darwin-aarch64", "darwin-x86_64"]
    } else if rest.ends_with("aarch64.app.tar.gz") {
        vec!["darwin-aarch64"]
    } else if rest.ends_with("x64.app.tar.gz") {
        vec!["darwin-x86_64"]
    } else {
        Vec::new()
    }
}

/// Only the artifacts the in-app updater downloads (`.sig` files are skipped).
fn is_updater_artifact(name: &str) -> bool {
    (name.ends_with(".zip") || name.ends_with(".tar.gz")) && !name.ends_with(".sig")
}

/// Recursive: the bundler nests artifacts per bundle type (`nsis/`, `appimage/`,
/// `macos/`), the previous release's assets are flat.
fn collect_artifacts(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let name = path.file_name().and_then(|name| name.to_str());
                if name.is_some_and(is_updater_artifact) {
                    found.push(path);
                }
            }
        }
    }
    found.sort();
    found
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn run(old: &Path, new: &Path, out: &Path) -> std::io::Result<Option<DeltaManifest>> {
    let mut previous: BTreeMap<String, (String, PathBuf)> = BTreeMap::new();
    for path in collect_artifacts(old) {
        let name = file_name(&path);
        if let Some((version, kind)) = split_release_name(&name) {
            previous.insert(kind, (version, path));
        }
    }

    let mut patches = Vec::new();
    let mut version: Option<String> = None;
    for path in collect_artifacts(new) {
        let name = file_name(&path);
        let Some((to_version, kind)) = split_release_name(&name) else {
            continue;
        };
        let targets = targets_for(&kind);
        if targets.is_empty() {
            println!("skip {name}: no updater target for this artifact kind");
            continue;
        }
        let Some((from_version, old_path)) = previous.get(&kind) else {
            println!("skip {name}: the previous release has no {kind}");
            continue;
        };
        if version.as_deref().is_some_and(|known| known != to_version) {
            println!(
                "skip {name}: already generating patches for {}",
                version.as_deref().unwrap_or_default()
            );
            continue;
        }

        let old_bytes = std::fs::read(old_path)?;
        let new_bytes = std::fs::read(&path)?;
        let mut patch = Vec::new();
        qbsdiff::Bsdiff::new(&old_bytes, &new_bytes)
            .compare(std::io::Cursor::new(&mut patch))
            .map_err(|error| std::io::Error::other(format!("bsdiff {name}: {error}")))?;

        let file = format!("{name}.from-{from_version}.patch");
        std::fs::create_dir_all(out)?;
        std::fs::write(out.join(&file), &patch)?;
        println!(
            "{file}: {} bytes of patch for {} bytes of artifact ({from_version} -> {to_version})",
            patch.len(),
            new_bytes.len()
        );

        let sha256 = sha256_hex(&patch);
        let artifact_sha256 = sha256_hex(&new_bytes);
        for target in targets {
            patches.push(DeltaPatch {
                target: target.to_string(),
                from_version: from_version.clone(),
                to_version: to_version.clone(),
                file: file.clone(),
                sha256: sha256.clone(),
                artifact_sha256: artifact_sha256.clone(),
            });
        }
        version.get_or_insert(to_version);
    }

    let Some(version) = version else {
        return Ok(None);
    };
    if patches.is_empty() {
        return Ok(None);
    }

    let manifest = DeltaManifest { version, patches };
    std::fs::write(out.join(MANIFEST_FILE), serde_json::to_vec_pretty(&manifest)?)?;
    Ok(Some(manifest))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent dir");
        }
        std::fs::write(path, bytes).expect("file written");
    }

    #[test]
    fn should_split_a_release_name_into_version_and_kind() {
        assert_eq!(
            split_release_name("pureplayer_0.3.0_x64-setup.nsis.zip"),
            Some(("0.3.0".to_string(), "x64-setup.nsis.zip".to_string()))
        );
        assert_eq!(
            split_release_name("pureplayer_0.3.0_universal.app.tar.gz"),
            Some(("0.3.0".to_string(), "universal.app.tar.gz".to_string()))
        );
    }

    #[test]
    fn should_not_split_a_name_without_a_version() {
        assert_eq!(split_release_name("latest.json"), None);
        assert_eq!(split_release_name("pureplayer_setup.exe"), None);
    }

    #[test]
    fn should_target_windows_installers_for_windows() {
        assert_eq!(targets_for("x64-setup.nsis.zip"), vec!["windows-x86_64"]);
    }

    #[test]
    fn should_target_linux_for_appimage() {
        assert_eq!(targets_for("amd64.AppImage.tar.gz"), vec!["linux-x86_64"]);
    }

    #[test]
    fn should_target_both_arches_for_a_universal_macos_artifact() {
        assert_eq!(
            targets_for("universal.app.tar.gz"),
            vec!["darwin-aarch64", "darwin-x86_64"]
        );
    }

    #[test]
    fn should_skip_artifacts_it_does_not_recognise() {
        assert!(targets_for("amd64.deb").is_empty());
        assert!(targets_for("x64.msi.zip").is_empty());
    }

    #[test]
    fn should_treat_zip_and_tarball_artifacts_as_updates_but_not_signatures() {
        assert!(is_updater_artifact("pureplayer_0.3.0_x64-setup.nsis.zip"));
        assert!(is_updater_artifact("pureplayer_0.3.0_universal.app.tar.gz"));
        assert!(!is_updater_artifact(
            "pureplayer_0.3.0_x64-setup.nsis.zip.sig"
        ));
        assert!(!is_updater_artifact("latest.json"));
    }

    #[test]
    fn should_generate_a_patch_that_reconstructs_the_new_artifact_and_write_the_manifest() {
        let dir = tempfile::tempdir().expect("temp dir");
        let old_dir = dir.path().join("old");
        let new_dir = dir.path().join("new");
        let out_dir = dir.path().join("out");
        std::fs::create_dir_all(&out_dir).expect("out dir");

        let mut new_bytes = vec![3u8; 8192];
        new_bytes.extend_from_slice(b"new release bytes");
        write(
            &old_dir.join("pureplayer_0.3.0_x64-setup.nsis.zip"),
            &vec![3u8; 8192],
        );
        write(
            &new_dir.join("nsis").join("pureplayer_0.4.0_x64-setup.nsis.zip"),
            &new_bytes,
        );

        let manifest = run(&old_dir, &new_dir, &out_dir)
            .expect("patch generated")
            .expect("manifest");

        assert_eq!(manifest.version, "0.4.0");
        assert_eq!(manifest.patches.len(), 1);
        let patch = &manifest.patches[0];
        assert_eq!(patch.target, "windows-x86_64");
        assert_eq!(patch.from_version, "0.3.0");
        assert_eq!(patch.to_version, "0.4.0");
        assert_eq!(patch.artifact_sha256, sha256_hex(&new_bytes));

        let patch_bytes = std::fs::read(out_dir.join(&patch.file)).expect("patch file");
        assert_eq!(patch.sha256, sha256_hex(&patch_bytes));
        let old_bytes = vec![3u8; 8192];
        let mut patched = Vec::new();
        qbsdiff::Bspatch::new(&patch_bytes)
            .expect("readable patch")
            .apply(&old_bytes, &mut patched)
            .expect("patch applies");
        assert_eq!(patched, new_bytes);

        let written = std::fs::read_to_string(out_dir.join(MANIFEST_FILE)).expect("manifest file");
        let parsed: DeltaManifest = serde_json::from_str(&written).expect("manifest parses");
        assert_eq!(parsed.patches.len(), 1);
    }

    #[test]
    fn should_emit_one_entry_per_target_for_a_universal_artifact() {
        let dir = tempfile::tempdir().expect("temp dir");
        let old_dir = dir.path().join("old");
        let new_dir = dir.path().join("new");
        let out_dir = dir.path().join("out");
        std::fs::create_dir_all(&out_dir).expect("out dir");

        write(
            &old_dir.join("pureplayer_0.3.0_universal.app.tar.gz"),
            b"old mac bytes",
        );
        write(
            &new_dir.join("macos").join("pureplayer_0.4.0_universal.app.tar.gz"),
            b"new mac bytes",
        );

        let manifest = run(&old_dir, &new_dir, &out_dir)
            .expect("patch generated")
            .expect("manifest");

        let mut targets: Vec<&str> = manifest
            .patches
            .iter()
            .map(|patch| patch.target.as_str())
            .collect();
        targets.sort_unstable();
        assert_eq!(targets, vec!["darwin-aarch64", "darwin-x86_64"]);
        assert!(manifest.patches.iter().all(|p| p.file == manifest.patches[0].file));
    }

    #[test]
    fn should_skip_when_the_previous_release_has_no_matching_artifact() {
        let dir = tempfile::tempdir().expect("temp dir");
        let old_dir = dir.path().join("old");
        let new_dir = dir.path().join("new");
        let out_dir = dir.path().join("out");
        std::fs::create_dir_all(&old_dir).expect("old dir");
        std::fs::create_dir_all(&out_dir).expect("out dir");

        write(
            &new_dir.join("pureplayer_0.4.0_x64-setup.nsis.zip"),
            b"new bytes",
        );

        let manifest = run(&old_dir, &new_dir, &out_dir).expect("no error");

        assert!(manifest.is_none());
        assert!(!out_dir.join(MANIFEST_FILE).exists());
    }

    #[test]
    fn should_skip_the_signature_file_next_to_an_artifact() {
        let dir = tempfile::tempdir().expect("temp dir");
        let old_dir = dir.path().join("old");
        let new_dir = dir.path().join("new");
        let out_dir = dir.path().join("out");
        std::fs::create_dir_all(&out_dir).expect("out dir");

        write(
            &old_dir.join("pureplayer_0.3.0_x64-setup.nsis.zip"),
            b"old bytes",
        );
        write(
            &old_dir.join("pureplayer_0.3.0_x64-setup.nsis.zip.sig"),
            b"signature",
        );
        write(
            &new_dir.join("pureplayer_0.4.0_x64-setup.nsis.zip"),
            b"new bytes",
        );
        write(
            &new_dir.join("pureplayer_0.4.0_x64-setup.nsis.zip.sig"),
            b"signature",
        );

        let manifest = run(&old_dir, &new_dir, &out_dir)
            .expect("patch generated")
            .expect("manifest");

        assert_eq!(manifest.patches.len(), 1);
    }
}

fn main() {
    let mut old = None;
    let mut new = None;
    let mut out = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--old" => old = args.next(),
            "--new" => new = args.next(),
            "--out" => out = args.next(),
            other => {
                eprintln!("unexpected argument: {other}");
                std::process::exit(2);
            }
        }
    }
    let (Some(old), Some(new), Some(out)) = (old, new, out) else {
        eprintln!("usage: patchgen --old <dir> --new <dir> --out <dir>");
        std::process::exit(2);
    };

    match run(Path::new(&old), Path::new(&new), Path::new(&out)) {
        Ok(Some(manifest)) => {
            println!(
                "wrote {} patch(es) for {} into {out}",
                manifest.patches.len(),
                manifest.version
            );
        }
        Ok(None) => println!("no matching artifacts to patch; nothing written"),
        Err(error) => {
            eprintln!("patchgen failed: {error}");
            std::process::exit(1);
        }
    }
}
