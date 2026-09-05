use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub metadata: ProjectMetadata,
    pub sheets: Vec<SchematicSheet>,
    pub simulation_profiles: Vec<SimulationProfile>,
    #[serde(default)]
    pub spice_libraries: Vec<SpiceLibrary>,
    /// Validated, content-addressed device packs embedded in the project.
    #[serde(default)]
    pub device_packs: Vec<crate::device_pack::EmbeddedDevicePack>,
    /// Logical parts shared by one or more independently placed symbol units.
    #[serde(default)]
    pub device_instances: Vec<DeviceInstance>,
    pub active_simulation_profile: Option<Uuid>,
    pub ui_view_state: UiViewState,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchematicSheet {
    pub id: Uuid,
    pub name: String,
    pub components: Vec<Component>,
    pub wires: Vec<Wire>,
    #[serde(default)]
    pub net_labels: Vec<NetLabel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub id: Uuid,
    pub kind: ComponentKind,
    pub position: Point,
    pub rotation: i32,
    pub parameters: BTreeMap<String, String>,
    pub pins: Vec<Pin>,
    pub display_name: String,
    pub spice_ref: String,
    #[serde(default)]
    pub model: Option<ModelBinding>,
    #[serde(default)]
    pub device: Option<DeviceBinding>,
    #[serde(default)]
    pub symbol_width: Option<f64>,
    #[serde(default)]
    pub symbol_height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ComponentKind {
    Resistor,
    Capacitor,
    Inductor,
    VoltageSource,
    CurrentSource,
    Diode,
    BipolarTransistor,
    Mosfet,
    Subcircuit,
    Ground,
    NetLabel,
    Device,
}

impl ComponentKind {
    pub fn prefix(&self) -> &'static str {
        match self {
            Self::Resistor => "R",
            Self::Capacitor => "C",
            Self::Inductor => "L",
            Self::VoltageSource => "V",
            Self::CurrentSource => "I",
            Self::Diode => "D",
            Self::BipolarTransistor => "Q",
            Self::Mosfet => "M",
            Self::Subcircuit => "X",
            Self::Device => "U",
            Self::Ground | Self::NetLabel => "",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub id: String,
    pub name: String,
    pub offset: Point,
    #[serde(default)]
    pub number: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub electrical_type: Option<PinElectricalType>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub voltage_domain_id: Option<String>,
    #[serde(default)]
    pub voltage_min: Option<f64>,
    #[serde(default)]
    pub voltage_max: Option<f64>,
    #[serde(default)]
    pub alternate_functions: Vec<String>,
    #[serde(default)]
    pub differential_pair_id: Option<String>,
    #[serde(default)]
    pub differential_polarity: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub allow_floating: bool,
    #[serde(default)]
    pub no_connect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PinElectricalType {
    Passive,
    Input,
    Output,
    Bidirectional,
    OpenDrain,
    OpenCollector,
    PowerInput,
    PowerOutput,
    NoConnect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceBinding {
    /// Stable identity shared by every symbol unit belonging to one physical part.
    #[serde(default)]
    pub logical_instance_id: Option<Uuid>,
    pub pack_sha256: String,
    pub pack_id: String,
    pub pack_version: String,
    pub device_id: String,
    pub variant_id: Option<String>,
    pub symbol_unit_id: Option<String>,
    pub capabilities: Vec<crate::device_pack::DevicePackCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInstance {
    pub id: Uuid,
    pub pack_sha256: String,
    pub pack_id: String,
    pub pack_version: String,
    pub device_id: String,
    #[serde(default)]
    pub variant_id: Option<String>,
    pub reference: String,
    pub display_name: String,
    #[serde(default)]
    pub model: Option<ModelBinding>,
    #[serde(default)]
    pub capabilities: Vec<crate::device_pack::DevicePackCapability>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Wire {
    pub id: Uuid,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NetLabel {
    pub id: Uuid,
    pub name: String,
    pub position: Point,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulationProfile {
    pub id: Uuid,
    pub name: String,
    pub analysis: Analysis,
    #[serde(default)]
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpiceLibrary {
    pub id: Uuid,
    pub name: String,
    pub source_name: String,
    pub sha256: String,
    pub models: Vec<SpiceModelDefinition>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpiceModelDefinition {
    pub name: String,
    pub kind: SpiceModelKind,
    pub pins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SpiceModelKind {
    Diode,
    Bipolar,
    Mosfet,
    Subcircuit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelBinding {
    pub library_id: Uuid,
    pub model_name: String,
    pub kind: SpiceModelKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Analysis {
    OperatingPoint,
    Transient {
        step: String,
        stop: String,
    },
    DcSweep {
        source: String,
        start: String,
        stop: String,
        step: String,
    },
    AcSweep {
        variation: String,
        points: u32,
        start: String,
        stop: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiViewState {
    pub active_sheet_id: Uuid,
    pub zoom: f64,
    pub pan: Point,
    pub grid_visible: bool,
}

impl Project {
    pub fn blank(name: &str) -> Self {
        let now = Utc::now();
        let sheet_id = Uuid::new_v4();
        let profile_id = Uuid::new_v4();
        Self {
            schema_version: SCHEMA_VERSION,
            metadata: ProjectMetadata {
                id: Uuid::new_v4(),
                name: name.to_owned(),
                description: String::new(),
                author: String::new(),
            },
            sheets: vec![SchematicSheet {
                id: sheet_id,
                name: "Main".into(),
                components: vec![],
                wires: vec![],
                net_labels: vec![],
            }],
            simulation_profiles: vec![SimulationProfile {
                id: profile_id,
                name: "Transient".into(),
                analysis: Analysis::Transient {
                    step: "10u".into(),
                    stop: "30m".into(),
                },
                signals: vec!["v(in)".into(), "v(out)".into()],
            }],
            spice_libraries: vec![],
            device_packs: vec![],
            device_instances: vec![],
            active_simulation_profile: Some(profile_id),
            ui_view_state: UiViewState {
                active_sheet_id: sheet_id,
                zoom: 1.0,
                pan: Point { x: 0.0, y: 0.0 },
                grid_visible: true,
            },
            created_at: now,
            updated_at: now,
        }
    }
}

pub fn component(kind: ComponentKind, x: f64, y: f64, spice_ref: &str, value: &str) -> Component {
    let vertical = matches!(
        kind,
        ComponentKind::VoltageSource | ComponentKind::CurrentSource
    );
    let pins = if kind == ComponentKind::NetLabel {
        vec![Pin {
            id: "1".into(),
            name: "NET".into(),
            offset: Point { x: 0.0, y: 0.0 },
            ..Pin::default()
        }]
    } else if kind == ComponentKind::Ground {
        vec![Pin {
            id: "1".into(),
            name: "GND".into(),
            offset: Point { x: 0.0, y: -20.0 },
            ..Pin::default()
        }]
    } else if vertical {
        vec![
            Pin {
                id: "1".into(),
                name: "+".into(),
                offset: Point { x: 0.0, y: -30.0 },
                ..Pin::default()
            },
            Pin {
                id: "2".into(),
                name: "-".into(),
                offset: Point { x: 0.0, y: 30.0 },
                ..Pin::default()
            },
        ]
    } else {
        vec![
            Pin {
                id: "1".into(),
                name: "1".into(),
                offset: Point { x: -40.0, y: 0.0 },
                ..Pin::default()
            },
            Pin {
                id: "2".into(),
                name: "2".into(),
                offset: Point { x: 40.0, y: 0.0 },
                ..Pin::default()
            },
        ]
    };
    let mut parameters = BTreeMap::new();
    parameters.insert("value".into(), value.into());
    Component {
        id: Uuid::new_v4(),
        kind,
        position: Point { x, y },
        rotation: 0,
        parameters,
        pins,
        display_name: spice_ref.into(),
        spice_ref: spice_ref.into(),
        model: None,
        device: None,
        symbol_width: None,
        symbol_height: None,
    }
}

pub fn modeled_component(
    definition: &SpiceModelDefinition,
    library_id: Uuid,
    position: Point,
    spice_ref: &str,
) -> Component {
    let kind = match definition.kind {
        SpiceModelKind::Diode => ComponentKind::Diode,
        SpiceModelKind::Bipolar => ComponentKind::BipolarTransistor,
        SpiceModelKind::Mosfet => ComponentKind::Mosfet,
        SpiceModelKind::Subcircuit => ComponentKind::Subcircuit,
    };
    let count = definition.pins.len();
    let pins = definition
        .pins
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let offset = if count == 2 {
                Point {
                    x: if index == 0 { -40.0 } else { 40.0 },
                    y: 0.0,
                }
            } else if count == 3 {
                match index {
                    0 => Point { x: 20.0, y: -30.0 },
                    1 => Point { x: -40.0, y: 0.0 },
                    _ => Point { x: 20.0, y: 30.0 },
                }
            } else {
                let left_count = count.div_ceil(2);
                let on_left = index < left_count;
                let row = if on_left { index } else { index - left_count };
                let rows = if on_left {
                    left_count
                } else {
                    count - left_count
                };
                Point {
                    x: if on_left { -50.0 } else { 50.0 },
                    y: (row as f64 - (rows.saturating_sub(1)) as f64 / 2.0) * 20.0,
                }
            };
            Pin {
                id: (index + 1).to_string(),
                name: name.clone(),
                offset,
                ..Pin::default()
            }
        })
        .collect();
    Component {
        id: Uuid::new_v4(),
        kind,
        position,
        rotation: 0,
        parameters: BTreeMap::new(),
        pins,
        display_name: definition.name.clone(),
        spice_ref: spice_ref.into(),
        model: Some(ModelBinding {
            library_id,
            model_name: definition.name.clone(),
            kind: definition.kind.clone(),
        }),
        device: None,
        symbol_width: None,
        symbol_height: None,
    }
}

#[cfg(test)]
pub fn test_rc_project() -> Project {
    let mut project = Project::blank("RC Pulse Response");
    let source = component(
        ComponentKind::VoltageSource,
        180.0,
        200.0,
        "V1",
        "PULSE(0 5 0 1u 1u 5m 10m)",
    );
    let resistor = component(ComponentKind::Resistor, 340.0, 170.0, "R1", "1k");
    let mut capacitor = component(ComponentKind::Capacitor, 460.0, 240.0, "C1", "1u");
    capacitor.rotation = 90;
    let ground = component(ComponentKind::Ground, 320.0, 330.0, "", "");
    let wires = vec![
        wire(&[(180., 170.), (300., 170.)]),
        wire(&[(380., 170.), (460., 170.), (460., 200.)]),
        wire(&[(460., 280.), (460., 310.), (320., 310.)]),
        wire(&[(180., 230.), (180., 310.), (320., 310.)]),
    ];
    let labels = vec![
        NetLabel {
            id: Uuid::new_v4(),
            name: "in".into(),
            position: Point { x: 180., y: 170. },
        },
        NetLabel {
            id: Uuid::new_v4(),
            name: "out".into(),
            position: Point { x: 380., y: 170. },
        },
    ];
    project.sheets[0].components = vec![source, resistor, capacitor, ground];
    project.sheets[0].wires = wires;
    project.sheets[0].net_labels = labels;
    project
}

#[cfg(test)]
fn wire(points: &[(f64, f64)]) -> Wire {
    Wire {
        id: Uuid::new_v4(),
        points: points.iter().map(|(x, y)| Point { x: *x, y: *y }).collect(),
    }
}
