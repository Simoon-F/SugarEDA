//! Persisted board-level bindings for vendor-neutral device configuration IR.

mod checker;
mod commands;
mod editor;
mod export;
mod source;
mod types;
mod validation;

pub(crate) use types::BoardConfiguration;
pub use types::{
    BoardConfigurationCheckReport, BoardConfigurationExportFormat, BoardConfigurationExportReceipt,
    BoardConfigurationSourceFormat,
};

pub use checker::check_all;
pub(crate) use commands::{
    apply_board_configuration_draft, export_board_configuration, validate_board_configuration_draft,
};
pub(crate) use editor::{build_from_draft, validate_draft};
pub(crate) use export::export_configuration;
pub(crate) use source::load_for_instance;
pub(crate) use validation::{validate_candidate as validate_project_candidate, validate_project};

#[cfg(test)]
mod tests;
