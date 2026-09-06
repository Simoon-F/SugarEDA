use super::{DetachedDevicePackSignature, TrustedDevicePackKey};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Write, path::PathBuf};

const TRUST_STORE_VERSION: u32 = 1;
const MAX_TRUSTED_KEYS: usize = 256;
const MAX_TRUST_STORE_BYTES: u64 = 256 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustDocument {
    #[serde(default = "trust_store_version")]
    version: u32,
    #[serde(default)]
    keys: Vec<TrustedDevicePackKey>,
}

fn trust_store_version() -> u32 {
    TRUST_STORE_VERSION
}

pub(super) struct DevicePackTrustStore {
    path: PathBuf,
}

impl DevicePackTrustStore {
    pub(super) fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub(super) fn list(&self) -> Result<Vec<TrustedDevicePackKey>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let metadata = std::fs::symlink_metadata(&self.path).map_err(|error| error.to_string())?;
        if !metadata.file_type().is_file() || metadata.len() > MAX_TRUST_STORE_BYTES {
            return Err(
                "DevicePack trust store must be a regular file no larger than 256 KiB".into(),
            );
        }
        let document: TrustDocument =
            serde_json::from_slice(&std::fs::read(&self.path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        validate_document(&document)?;
        Ok(document.keys)
    }

    pub(super) fn trust(
        &self,
        envelope: &DetachedDevicePackSignature,
    ) -> Result<Vec<TrustedDevicePackKey>, String> {
        let fingerprint = fingerprint(&envelope.public_key_base64)?;
        let mut keys = self.list()?;
        keys.retain(|key| key.fingerprint != fingerprint);
        if keys.len() >= MAX_TRUSTED_KEYS {
            return Err(format!(
                "DevicePack trust store is limited to {MAX_TRUSTED_KEYS} keys"
            ));
        }
        keys.push(TrustedDevicePackKey {
            key_id: envelope.key_id.clone(),
            signer: envelope.signer.clone(),
            public_key_base64: envelope.public_key_base64.clone(),
            fingerprint,
            trusted_at: Utc::now().to_rfc3339(),
        });
        keys.sort_by(|left, right| {
            left.signer
                .cmp(&right.signer)
                .then(left.key_id.cmp(&right.key_id))
        });
        self.write(&keys)?;
        Ok(keys)
    }

    pub(super) fn remove(&self, fingerprint: &str) -> Result<Vec<TrustedDevicePackKey>, String> {
        if !valid_fingerprint(fingerprint) {
            return Err("Trusted-key fingerprint must be lowercase SHA-256".into());
        }
        let mut keys = self.list()?;
        keys.retain(|key| key.fingerprint != fingerprint);
        self.write(&keys)?;
        Ok(keys)
    }

    fn write(&self, keys: &[TrustedDevicePackKey]) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "DevicePack trust-store path has no parent".to_owned())?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec_pretty(&TrustDocument {
            version: TRUST_STORE_VERSION,
            keys: keys.to_vec(),
        })
        .map_err(|error| error.to_string())?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        temporary
            .persist(&self.path)
            .map_err(|error| error.error.to_string())?;
        Ok(())
    }
}

pub(super) fn fingerprint(public_key_base64: &str) -> Result<String, String> {
    let public_key = STANDARD
        .decode(public_key_base64)
        .map_err(|_| "publicKeyBase64 is not valid Base64".to_owned())?;
    if public_key.len() != 32 {
        return Err("Ed25519 public key must contain 32 bytes".into());
    }
    Ok(format!("{:x}", Sha256::digest(public_key)))
}

fn validate_document(document: &TrustDocument) -> Result<(), String> {
    if document.version != TRUST_STORE_VERSION || document.keys.len() > MAX_TRUSTED_KEYS {
        return Err("Unsupported or oversized DevicePack trust store".into());
    }
    let mut fingerprints = std::collections::BTreeSet::new();
    for key in &document.keys {
        if !safe_text(&key.key_id, 128)
            || !safe_text(&key.signer, 256)
            || !safe_text(&key.trusted_at, 64)
            || !valid_fingerprint(&key.fingerprint)
            || fingerprint(&key.public_key_base64)? != key.fingerprint
            || !fingerprints.insert(key.fingerprint.as_str())
        {
            return Err("DevicePack trust store contains an invalid key".into());
        }
    }
    Ok(())
}

fn safe_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    #[test]
    fn trust_store_round_trips_and_removes_a_key() {
        let directory = tempfile::tempdir().unwrap();
        let store = DevicePackTrustStore::new(directory.path().join("trusted-keys.json"));
        let key = SigningKey::from_bytes(&[11_u8; 32]);
        let envelope = DetachedDevicePackSignature {
            format_version: 1,
            algorithm: "ed25519".into(),
            key_id: "test-key".into(),
            signer: "SugarEDA Test Publisher".into(),
            pack_sha256: "0".repeat(64),
            public_key_base64: STANDARD.encode(key.verifying_key().as_bytes()),
            signature_base64: STANDARD.encode([0_u8; 64]),
        };
        let keys = store.trust(&envelope).unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(store.list().unwrap(), keys);
        assert!(store.remove(&keys[0].fingerprint).unwrap().is_empty());
    }

    #[test]
    fn rejects_a_tampered_persisted_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("trusted-keys.json");
        let key = SigningKey::from_bytes(&[13_u8; 32]);
        let document = serde_json::json!({
            "version": 1,
            "keys": [{
                "keyId": "test-key",
                "signer": "SugarEDA Test Publisher",
                "publicKeyBase64": STANDARD.encode(key.verifying_key().as_bytes()),
                "fingerprint": "0".repeat(64),
                "trustedAt": "2026-01-01T00:00:00Z"
            }]
        });
        std::fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
        let store = DevicePackTrustStore::new(path);
        assert!(store.list().is_err());
    }
}
