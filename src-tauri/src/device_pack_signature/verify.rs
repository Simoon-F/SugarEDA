use super::{
    trust_store::fingerprint, DetachedDevicePackSignature, DevicePackSignatureReport,
    TrustedDevicePackKey,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::path::Path;

const SIGNATURE_FORMAT_VERSION: u32 = 1;
const SIGNATURE_ALGORITHM: &str = "ed25519";
const MAX_SIGNATURE_FILE_BYTES: u64 = 64 * 1024;

pub(super) fn inspect_files(
    pack_path: &Path,
    signature_path: &Path,
    trusted_keys: &[TrustedDevicePackKey],
) -> Result<DevicePackSignatureReport, String> {
    validate_names(pack_path, signature_path)?;
    let pack = crate::device_pack::import(pack_path).map_err(|error| error.to_string())?;
    let envelope = read_signature_envelope(signature_path)?;
    let key_fingerprint = fingerprint(&envelope.public_key_base64)?;
    let trusted_identity = trusted_keys.iter().any(|key| {
        key.fingerprint == key_fingerprint && key.public_key_base64 == envelope.public_key_base64
    });
    if envelope.pack_sha256 != pack.sha256 {
        return Ok(report(
            &envelope,
            &key_fingerprint,
            false,
            false,
            "device-pack-signature.hash-mismatch",
            "签名声明的内容哈希与器件包不一致",
            "The signature envelope hash does not match the DevicePack",
        ));
    }
    let public_key = STANDARD
        .decode(&envelope.public_key_base64)
        .map_err(|_| "publicKeyBase64 is not valid Base64".to_owned())?;
    let signature = STANDARD
        .decode(&envelope.signature_base64)
        .map_err(|_| "signatureBase64 is not valid Base64".to_owned())?;
    let public_key: [u8; 32] = public_key
        .try_into()
        .map_err(|_| "Ed25519 public key must contain 32 bytes".to_owned())?;
    let signature = Signature::from_slice(&signature)
        .map_err(|_| "Ed25519 signature must contain 64 bytes".to_owned())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "Ed25519 public key is invalid".to_owned())?;
    let message = signing_message(&envelope.pack_sha256);
    if verifying_key
        .verify(message.as_bytes(), &signature)
        .is_err()
    {
        return Ok(report(
            &envelope,
            &key_fingerprint,
            false,
            false,
            "device-pack-signature.invalid-signature",
            "Ed25519 签名无效，器件包来源或内容不可验证",
            "The Ed25519 signature is invalid; pack origin or content cannot be verified",
        ));
    }
    if trusted_identity {
        return Ok(report(
            &envelope,
            &key_fingerprint,
            true,
            true,
            "device-pack-signature.verified-trusted",
            "签名与内容匹配，且该公钥已由用户加入本地信任库",
            "The signature matches the content and the user has trusted this key locally",
        ));
    }
    Ok(report(
        &envelope,
        &key_fingerprint,
        true,
        false,
        "device-pack-signature.verified-untrusted",
        "签名与内容匹配，但公钥尚未加入本地信任库；不能据此声称厂商身份可信",
        "The signature matches the content, but the key is not locally trusted; vendor identity is not established",
    ))
}

pub(super) fn read_signature_envelope(
    signature_path: &Path,
) -> Result<DetachedDevicePackSignature, String> {
    let metadata = std::fs::symlink_metadata(signature_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SIGNATURE_FILE_BYTES {
        return Err("Detached signature must be a regular file no larger than 64 KiB".into());
    }
    let bytes = std::fs::read(signature_path).map_err(|error| error.to_string())?;
    let envelope: DetachedDevicePackSignature =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}

fn validate_names(pack_path: &Path, signature_path: &Path) -> Result<(), String> {
    let pack_name = pack_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let signature_name = signature_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !(pack_name.ends_with(".devicepack.json") || pack_name.ends_with(".sugeda-pack.json")) {
        return Err("DevicePack path has an unsupported extension".into());
    }
    if !signature_name.ends_with(".devicepack.sig.json") {
        return Err("Detached signature requires the .devicepack.sig.json extension".into());
    }
    Ok(())
}

fn validate_envelope(envelope: &DetachedDevicePackSignature) -> Result<(), String> {
    if envelope.format_version != SIGNATURE_FORMAT_VERSION {
        return Err(format!(
            "Unsupported signature format version {}",
            envelope.format_version
        ));
    }
    if envelope.algorithm != SIGNATURE_ALGORITHM {
        return Err("Only Ed25519 detached signatures are supported".into());
    }
    if !safe_text(&envelope.key_id, 128) || !safe_text(&envelope.signer, 256) {
        return Err("Signature keyId or signer metadata is invalid".into());
    }
    if envelope.pack_sha256.len() != 64
        || !envelope
            .pack_sha256
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
    {
        return Err("Signature packSha256 must be lowercase hexadecimal".into());
    }
    Ok(())
}

fn safe_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

fn signing_message(pack_sha256: &str) -> String {
    format!("SugarEDA DevicePack Signature v1\n{pack_sha256}")
}

fn report(
    envelope: &DetachedDevicePackSignature,
    public_key_fingerprint: &str,
    verified: bool,
    trusted_identity: bool,
    code: &str,
    message_zh: &str,
    message_en: &str,
) -> DevicePackSignatureReport {
    DevicePackSignatureReport {
        verified,
        trusted_identity,
        algorithm: envelope.algorithm.clone(),
        key_id: envelope.key_id.clone(),
        signer: envelope.signer.clone(),
        pack_sha256: envelope.pack_sha256.clone(),
        public_key_fingerprint: public_key_fingerprint.into(),
        code: code.into(),
        message_zh: message_zh.into(),
        message_en: message_en.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    #[test]
    fn verifies_content_but_does_not_claim_unknown_key_is_trusted() {
        let directory = tempfile::tempdir().unwrap();
        let pack_path = directory.path().join("fixture.devicepack.json");
        std::fs::write(
            &pack_path,
            include_bytes!("../../../examples/devicepacks/test-mcu.devicepack.json"),
        )
        .unwrap();
        let pack = crate::device_pack::import(&pack_path).unwrap();
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let signature = signing_key.sign(signing_message(&pack.sha256).as_bytes());
        let envelope = json!({
            "formatVersion": 1,
            "algorithm": "ed25519",
            "keyId": "test-key",
            "signer": "SugarEDA test signer",
            "packSha256": pack.sha256,
            "publicKeyBase64": STANDARD.encode(signing_key.verifying_key().as_bytes()),
            "signatureBase64": STANDARD.encode(signature.to_bytes()),
        });
        let signature_path = directory.path().join("fixture.devicepack.sig.json");
        std::fs::write(&signature_path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        let report = inspect_files(&pack_path, &signature_path, &[]).unwrap();
        assert!(report.verified);
        assert!(!report.trusted_identity);
        assert_eq!(report.code, "device-pack-signature.verified-untrusted");

        let trusted_key = TrustedDevicePackKey {
            key_id: "test-key".into(),
            signer: "SugarEDA test signer".into(),
            public_key_base64: STANDARD.encode(signing_key.verifying_key().as_bytes()),
            fingerprint: report.public_key_fingerprint.clone(),
            trusted_at: "2026-01-01T00:00:00Z".into(),
        };
        let trusted_report = inspect_files(&pack_path, &signature_path, &[trusted_key]).unwrap();
        assert!(trusted_report.trusted_identity);
        assert_eq!(
            trusted_report.code,
            "device-pack-signature.verified-trusted"
        );

        let mut mismatched = envelope;
        mismatched["packSha256"] = "0".repeat(64).into();
        std::fs::write(&signature_path, serde_json::to_vec(&mismatched).unwrap()).unwrap();
        let report = inspect_files(&pack_path, &signature_path, &[]).unwrap();
        assert!(!report.verified);
        assert_eq!(report.code, "device-pack-signature.hash-mismatch");

        std::fs::write(&pack_path, b"tampered").unwrap();
        assert!(inspect_files(&pack_path, &signature_path, &[]).is_err());
    }
}
