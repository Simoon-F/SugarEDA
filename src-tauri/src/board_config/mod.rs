//! Persisted board-level bindings for vendor-neutral device configuration IR.

mod checker;
mod source;
mod types;
mod validation;

pub(crate) use types::BoardConfiguration;
pub use types::{BoardConfigurationCheckReport, BoardConfigurationSourceFormat};

pub use checker::check_all;
pub(crate) use source::load_for_instance;
pub(crate) use validation::{validate_candidate as validate_project_candidate, validate_project};

#[cfg(test)]
mod tests;
