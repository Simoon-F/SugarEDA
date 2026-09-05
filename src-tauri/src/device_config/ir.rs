#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeviceConfig {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub source: String,
    pub license: String,
    pub target: DeviceConfigTarget,
    pub pin_mux: Vec<PinMuxAssignment>,
    pub boot_straps: Vec<BootStrapAssignment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeviceConfigTarget {
    pub pack_id: String,
    pub pack_version: String,
    pub device_id: String,
    pub variant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PinMuxAssignment {
    pub pin_id: String,
    pub function: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BootStrapAssignment {
    pub pin_id: String,
    pub value: BootStrapValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BootStrapValue {
    Low,
    High,
    PullDown,
    PullUp,
    External,
}
