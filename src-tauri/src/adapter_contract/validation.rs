use super::{AdapterContractManifest, AdapterContractReport, AdapterInputKind};
use std::collections::BTreeSet;

const CONTRACT_VERSION: u32 = 1;

pub(super) fn inspect_manifest(bytes: &[u8]) -> AdapterContractReport {
    let manifest = match serde_json::from_slice::<AdapterContractManifest>(bytes) {
        Ok(manifest) => manifest,
        Err(error) => return invalid("adapter-contract.invalid-json", error.to_string()),
    };
    if manifest.contract_version != CONTRACT_VERSION {
        return invalid(
            "adapter-contract.unsupported-version",
            format!("expected contract version {CONTRACT_VERSION}"),
        );
    }
    for (label, value) in [
        ("id", manifest.id.as_str()),
        ("name", &manifest.name),
        ("vendor", &manifest.vendor),
        ("version", &manifest.version),
        ("license", &manifest.license),
        ("source", &manifest.source),
    ] {
        if !safe_text(value) {
            return invalid(
                "adapter-contract.invalid-string",
                format!("{label} is empty, too long, or contains controls"),
            );
        }
    }
    if !portable_id(&manifest.id)
        || manifest.input_kinds.is_empty()
        || manifest.input_kinds.len() > 16
        || manifest
            .input_kinds
            .iter()
            .enumerate()
            .any(|(index, kind)| manifest.input_kinds[index + 1..].contains(kind))
        || manifest.supported_pack_ids.len() > 256
        || manifest
            .supported_pack_ids
            .iter()
            .any(|pack_id| !portable_id(pack_id))
        || !unique(manifest.supported_pack_ids.iter().map(String::as_str))
    {
        return invalid(
            "adapter-contract.invalid-metadata",
            "adapter IDs, inputs, or supported pack IDs are invalid".into(),
        );
    }
    if manifest.permissions.network_access
        || manifest.permissions.process_execution
        || manifest.permissions.project_files_read
    {
        return invalid(
            "adapter-contract.permission-denied",
            "v1 forbids network, process execution, and arbitrary project file access".into(),
        );
    }
    let consumes_selected_sdk_root = manifest
        .input_kinds
        .contains(&AdapterInputKind::SelectedSdkRootMetadataV1);
    if manifest.permissions.selected_sdk_root_read != consumes_selected_sdk_root {
        return invalid(
            "adapter-contract.permission-mismatch",
            "selectedSdkRootRead must exactly match the selectedSdkRootMetadataV1 input".into(),
        );
    }
    AdapterContractReport {
        valid: true,
        execution_available: false,
        manifest: Some(manifest),
        code: "adapter-contract.valid-inert-manifest".into(),
        message_zh: "Adapter 清单有效；本阶段仅验证契约，不加载或执行 Adapter".into(),
        message_en:
            "Adapter manifest is valid; this release validates the contract but does not load or execute adapters"
                .into(),
    }
}

fn invalid(code: &str, detail: String) -> AdapterContractReport {
    AdapterContractReport {
        valid: false,
        execution_available: false,
        manifest: None,
        code: code.into(),
        message_zh: format!("Adapter 契约无效：{detail}"),
        message_en: format!("Adapter contract is invalid: {detail}"),
    }
}

fn safe_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

fn portable_id(value: &str) -> bool {
    safe_text(value)
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.:+".contains(character))
}

fn unique<'a>(values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_inert_manifest_and_refuses_executable_permissions() {
        let fixture =
            include_bytes!("../../../examples/adapters/test-sdk-metadata.sugareda-adapter.json");
        let report = inspect_manifest(fixture);
        assert!(report.valid);
        assert!(!report.execution_available);

        let mut unsafe_fixture: serde_json::Value = serde_json::from_slice(fixture).unwrap();
        unsafe_fixture["permissions"]["processExecution"] = true.into();
        let report = inspect_manifest(&serde_json::to_vec(&unsafe_fixture).unwrap());
        assert!(!report.valid);
        assert_eq!(report.code, "adapter-contract.permission-denied");

        unsafe_fixture["permissions"]["processExecution"] = false.into();
        unsafe_fixture["permissions"]["selectedSdkRootRead"] = false.into();
        let report = inspect_manifest(&serde_json::to_vec(&unsafe_fixture).unwrap());
        assert!(!report.valid);
        assert_eq!(report.code, "adapter-contract.permission-mismatch");
    }
}
