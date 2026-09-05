//! Inert v1 contract for future authorized adapters.
//!
//! This module validates metadata and exposes request/response DTOs only. It
//! does not discover, load, or execute adapter code in this release.

mod commands;
mod types;
mod validation;

pub(crate) use commands::validate_adapter_contract;
use types::AdapterContractReport;
pub use types::{
    AdapterContractManifest, AdapterContractPermissions, AdapterDiagnostic, AdapterInputKind,
    AdapterKind, AdapterOutputKind, AdapterRequestEnvelope, AdapterResponseEnvelope,
};
use validation::inspect_manifest;
