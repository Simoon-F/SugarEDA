use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTreeDiagnostic {
    pub code: &'static str,
    pub severity: &'static str,
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message_zh: String,
    pub message_en: String,
}

impl DeviceTreeDiagnostic {
    pub(super) fn error(
        code: &'static str,
        line: Option<usize>,
        column: Option<usize>,
        message_zh: impl Into<String>,
        message_en: impl Into<String>,
    ) -> Self {
        Self {
            code,
            severity: "error",
            line,
            column,
            message_zh: message_zh.into(),
            message_en: message_en.into(),
        }
    }
}
