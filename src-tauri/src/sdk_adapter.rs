//! Read-only SDK Adapter path discovery.
//!
//! This module never reads SDK file contents or executes SDK tools. It only
//! expands validated relative path patterns below a user-selected root.

use crate::domain::Project;
use serde::Serialize;
use std::{fs, path::Path};

const MAX_VISITED_ENTRIES: usize = 10_000;
const MAX_MATCHES_PER_PATTERN: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SdkAdapterReport {
    pub pack_sha256: String,
    pub adapter_id: String,
    pub sdk_type: String,
    pub version_requirement: String,
    pub selected_root: String,
    pub verification_level: &'static str,
    pub matched: bool,
    pub patterns: Vec<SdkPatternReport>,
    pub issues: Vec<SdkAdapterIssue>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SdkPatternReport {
    pub pattern: String,
    pub matches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SdkAdapterIssue {
    pub code: &'static str,
    pub severity: &'static str,
    pub message_zh: String,
    pub message_en: String,
}

pub fn inspect(
    project: &Project,
    pack_sha256: &str,
    adapter_id: &str,
    selected_root: &Path,
) -> Result<SdkAdapterReport, String> {
    let pack = project
        .device_packs
        .iter()
        .find(|pack| pack.sha256 == pack_sha256)
        .ok_or_else(|| "Device pack is not embedded in this project".to_owned())?;
    let adapter = pack
        .pack
        .sdk_adapters
        .iter()
        .find(|adapter| adapter.id == adapter_id)
        .ok_or_else(|| format!("SDK adapter '{adapter_id}' is unavailable"))?;
    let root = fs::canonicalize(selected_root)
        .map_err(|error| format!("Cannot access selected SDK root: {error}"))?;
    if !root.is_dir() {
        return Err("Selected SDK root is not a directory".into());
    }

    let mut budget = MAX_VISITED_ENTRIES;
    let mut truncated = false;
    let mut patterns = Vec::with_capacity(adapter.local_path_patterns.len());
    for pattern in &adapter.local_path_patterns {
        let mut matches = expand_pattern(&root, pattern, &mut budget, &mut truncated)?;
        matches.sort();
        matches.dedup();
        if matches.len() > MAX_MATCHES_PER_PATTERN {
            matches.truncate(MAX_MATCHES_PER_PATTERN);
            truncated = true;
        }
        patterns.push(SdkPatternReport {
            pattern: pattern.clone(),
            matches,
        });
    }
    let matched = patterns.iter().any(|pattern| !pattern.matches.is_empty());
    let mut issues = Vec::new();
    if !matched {
        issues.push(issue(
            "sdk.no_path_match",
            "error",
            "所选目录不匹配此 SDK Adapter 的任何安全路径模式",
            "The selected directory does not match any safe path pattern for this SDK Adapter",
        ));
    }
    if truncated {
        issues.push(issue(
            "sdk.scan_truncated",
            "warning",
            "SDK 目录扫描达到安全上限，结果已截断",
            "SDK directory scan reached its safety limit and was truncated",
        ));
    }
    issues.push(issue(
        "sdk.version_not_checked",
        "info",
        "仅验证了目录结构，未读取或推断 SDK 版本",
        "Only directory structure was checked; the SDK version was not read or inferred",
    ));
    Ok(SdkAdapterReport {
        pack_sha256: pack_sha256.to_owned(),
        adapter_id: adapter.id.clone(),
        sdk_type: adapter.sdk_type.clone(),
        version_requirement: adapter.version_requirement.clone(),
        selected_root: root.display().to_string(),
        verification_level: "pathMetadataOnly",
        matched,
        patterns,
        issues,
    })
}

fn expand_pattern(
    root: &Path,
    pattern: &str,
    budget: &mut usize,
    truncated: &mut bool,
) -> Result<Vec<String>, String> {
    if !safe_pattern(pattern) {
        return Err("SDK Adapter contains an unsafe path pattern".into());
    }
    let mut candidates = vec![root.to_path_buf()];
    for segment in pattern.split('/') {
        let mut next = Vec::new();
        for candidate in candidates {
            let Ok(candidate) = fs::canonicalize(candidate) else {
                continue;
            };
            if !candidate.starts_with(root) {
                continue;
            }
            if segment == "*" || safe_suffix_pattern(segment) {
                let entries = match fs::read_dir(&candidate) {
                    Ok(entries) => entries,
                    Err(_) => continue,
                };
                for entry in entries.flatten() {
                    if *budget == 0 {
                        *truncated = true;
                        break;
                    }
                    *budget -= 1;
                    let matches = segment == "*"
                        || entry
                            .file_name()
                            .to_str()
                            .is_some_and(|name| suffix_matches(segment, name));
                    if matches {
                        next.push(entry.path());
                    }
                }
            } else {
                let path = candidate.join(segment);
                if path.exists() {
                    next.push(path);
                }
            }
        }
        candidates = next;
        if candidates.is_empty() || *budget == 0 {
            break;
        }
    }
    let mut matches = Vec::new();
    for candidate in candidates {
        let Ok(canonical) = fs::canonicalize(candidate) else {
            continue;
        };
        if !canonical.starts_with(root) {
            continue;
        }
        let Ok(relative) = canonical.strip_prefix(root) else {
            continue;
        };
        matches.push(relative.to_string_lossy().replace('\\', "/"));
    }
    Ok(matches)
}

pub fn safe_pattern(pattern: &str) -> bool {
    !pattern.is_empty()
        && pattern.len() <= 512
        && !pattern.starts_with('/')
        && !pattern.contains(['\\', ':', '`', '$'])
        && pattern.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && (segment == "*"
                    || safe_suffix_pattern(segment)
                    || segment.chars().all(|character| {
                        character.is_ascii_alphanumeric()
                            || matches!(character, '-' | '_' | '.' | '+')
                    }))
        })
}

fn safe_suffix_pattern(segment: &str) -> bool {
    segment.strip_prefix("*.").is_some_and(|extension| {
        !extension.is_empty()
            && extension.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '+')
            })
    })
}

fn suffix_matches(pattern: &str, name: &str) -> bool {
    pattern
        .strip_prefix('*')
        .is_some_and(|suffix| name.ends_with(suffix))
}

fn issue(
    code: &'static str,
    severity: &'static str,
    zh: impl Into<String>,
    en: impl Into<String>,
) -> SdkAdapterIssue {
    SdkAdapterIssue {
        code,
        severity,
        message_zh: zh.into(),
        message_en: en.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_pack() -> (Project, String) {
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-mcu.devicepack.json"
        ))
        .unwrap();
        let hash = pack.sha256.clone();
        let mut project = Project::blank("sdk discovery");
        project.device_packs.push(pack);
        (project, hash)
    }

    #[test]
    fn matches_only_relative_structure_below_selected_root() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("sdk/v1/include")).unwrap();
        let (project, hash) = project_with_pack();
        let report = inspect(&project, &hash, "generic-cmsis", directory.path()).unwrap();
        assert!(report.matched);
        assert_eq!(report.patterns[0].matches, ["sdk/v1/include"]);
        assert_eq!(report.verification_level, "pathMetadataOnly");
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "sdk.version_not_checked"));
    }

    #[test]
    fn rejects_unsafe_wildcards_and_reports_no_match() {
        assert!(!safe_pattern("../sdk/*"));
        assert!(!safe_pattern("sdk/**/include"));
        assert!(!safe_pattern("sdk/foo*/include"));
        assert!(safe_pattern("device-tree/*.dtsi"));
        let directory = tempfile::tempdir().unwrap();
        let (project, hash) = project_with_pack();
        let report = inspect(&project, &hash, "generic-cmsis", directory.path()).unwrap();
        assert!(!report.matched);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "sdk.no_path_match"));
    }

    #[cfg(unix)]
    #[test]
    fn ignores_symlinks_that_escape_the_selected_root() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir_all(outside.path().join("v1/include")).unwrap();
        symlink(outside.path(), root.path().join("sdk")).unwrap();
        let (project, hash) = project_with_pack();
        let report = inspect(&project, &hash, "generic-cmsis", root.path()).unwrap();
        assert!(!report.matched);
    }

    #[test]
    fn matches_a_restricted_filename_suffix_pattern() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("device-tree")).unwrap();
        fs::write(directory.path().join("device-tree/board.dtsi"), b"").unwrap();
        let pack = crate::device_pack::import_bytes(include_bytes!(
            "../../examples/devicepacks/test-soc.devicepack.json"
        ))
        .unwrap();
        let hash = pack.sha256.clone();
        let mut project = Project::blank("suffix discovery");
        project.device_packs.push(pack);
        let report = inspect(&project, &hash, "soc-sdk-interface", directory.path()).unwrap();
        assert_eq!(report.patterns[1].matches, ["device-tree/board.dtsi"]);
    }
}
