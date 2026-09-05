use crate::domain::{SpiceLibrary, SpiceModelDefinition, SpiceModelKind};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use thiserror::Error;
use uuid::Uuid;

const MAX_MODEL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ModelImportError {
    #[error("model file must use .lib, .cir, .mod, .model, or .spice")]
    Extension,
    #[error("model file is larger than 2 MiB")]
    TooLarge,
    #[error("cannot read model file: {0}")]
    Read(#[from] std::io::Error),
    #[error("model file is not UTF-8 text")]
    Encoding,
    #[error("unsafe or unsupported directive on line {line}: {directive}")]
    UnsafeDirective { line: usize, directive: String },
    #[error("no supported .model or .subckt declaration was found")]
    NoModels,
    #[error("subcircuit '{0}' has no external pins")]
    NoPins(String),
    #[error("invalid model library: {0}")]
    Invalid(String),
}

pub fn import(path: &Path) -> Result<SpiceLibrary, ModelImportError> {
    validate_extension(path)?;
    if fs::metadata(path)?.len() > MAX_MODEL_BYTES {
        return Err(ModelImportError::TooLarge);
    }
    let bytes = fs::read(path)?;
    let content = String::from_utf8(bytes).map_err(|_| ModelImportError::Encoding)?;
    let models = inspect(&content)?;
    let sha256 = format!("{:x}", Sha256::digest(content.as_bytes()));
    Ok(SpiceLibrary {
        id: Uuid::new_v4(),
        name: path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Imported models")
            .to_owned(),
        source_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("models.lib")
            .to_owned(),
        sha256,
        models,
        content,
    })
}

pub fn validate_library(library: &SpiceLibrary) -> Result<(), ModelImportError> {
    let inspected = inspect(&library.content)?;
    if inspected != library.models
        || library.sha256 != format!("{:x}", Sha256::digest(library.content.as_bytes()))
    {
        return Err(ModelImportError::Invalid(
            "declarations or checksum do not match the embedded content".into(),
        ));
    }
    Ok(())
}

fn validate_extension(path: &Path) -> Result<(), ModelImportError> {
    let valid = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "lib" | "cir" | "mod" | "model" | "spice"
            )
        });
    valid.then_some(()).ok_or(ModelImportError::Extension)
}

fn inspect(content: &str) -> Result<Vec<SpiceModelDefinition>, ModelImportError> {
    if content.len() as u64 > MAX_MODEL_BYTES {
        return Err(ModelImportError::TooLarge);
    }
    if content.contains('\0') {
        return Err(ModelImportError::Encoding);
    }
    let mut models = Vec::new();
    let mut logical: Vec<(usize, String)> = Vec::new();
    for (index, source_line) in content.lines().enumerate() {
        let line = source_line.trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('*') {
            continue;
        }
        let line = line.split(';').next().unwrap_or("").trim();
        if let Some(continuation) = line.strip_prefix('+') {
            let Some((_, previous)) = logical.last_mut() else {
                return Err(ModelImportError::Invalid("orphan continuation line".into()));
            };
            previous.push(' ');
            previous.push_str(continuation);
        } else {
            logical.push((index, line.to_owned()));
        }
    }
    let mut subcircuits = Vec::new();
    for (index, line) in logical {
        let lower = line.to_ascii_lowercase();
        let fields: Vec<_> = line.split_whitespace().collect();
        let directive = fields.first().copied().unwrap_or("").to_ascii_lowercase();
        // Only textual analog devices are accepted. External code models and file-backed
        // sources need a separate importer with an explicit dependency policy.
        if line.contains('"')
            || line.contains('`')
            || line.contains('\\')
            || lower.contains("file=")
            || lower.contains("file =")
        {
            return Err(ModelImportError::UnsafeDirective {
                line: index + 1,
                directive: "external file/executable reference".into(),
            });
        }
        if lower.starts_with('.') {
            if !matches!(
                directive.as_str(),
                ".model"
                    | ".subckt"
                    | ".ends"
                    | ".param"
                    | ".func"
                    | ".if"
                    | ".elseif"
                    | ".else"
                    | ".endif"
            ) {
                return Err(ModelImportError::UnsafeDirective {
                    line: index + 1,
                    directive: directive.to_owned(),
                });
            }
        } else if !"rcldqjmzebfghivxstkw".contains(lower.chars().next().unwrap_or(' '))
            || subcircuits.is_empty()
        {
            return Err(ModelImportError::UnsafeDirective {
                line: index + 1,
                directive: fields.first().unwrap_or(&"").to_string(),
            });
        }
        if directive == ".model" {
            if fields.len() >= 3 {
                let model_type = fields[2]
                    .split('(')
                    .next()
                    .unwrap_or(fields[2])
                    .to_ascii_uppercase();
                let definition = match model_type.as_str() {
                    "D" => Some((SpiceModelKind::Diode, vec!["A", "K"])),
                    "NPN" | "PNP" => Some((SpiceModelKind::Bipolar, vec!["C", "B", "E"])),
                    "NMOS" | "PMOS" => Some((SpiceModelKind::Mosfet, vec!["D", "G", "S"])),
                    _ => None,
                };
                if let Some((kind, pins)) = definition.filter(|_| subcircuits.is_empty()) {
                    if !identifier(fields[1]) {
                        return Err(ModelImportError::Invalid("invalid model name".into()));
                    }
                    models.push(SpiceModelDefinition {
                        name: fields[1].to_owned(),
                        kind,
                        pins: pins.into_iter().map(str::to_owned).collect(),
                    });
                }
            }
        } else if directive == ".subckt" {
            if fields.len() >= 2 {
                let name = fields[1].to_owned();
                let pins: Vec<String> = fields
                    .iter()
                    .skip(2)
                    .take_while(|field| {
                        !field.to_ascii_lowercase().starts_with("params:") && !field.contains('=')
                    })
                    .map(|field| (*field).to_owned())
                    .collect();
                if pins.is_empty() {
                    return Err(ModelImportError::NoPins(name));
                }
                if pins.len() > 256
                    || !identifier(&name)
                    || pins.iter().any(|pin| !identifier(pin) || pin == "0")
                {
                    return Err(ModelImportError::Invalid(
                        "invalid subcircuit name or ports (maximum 256)".into(),
                    ));
                }
                if subcircuits.is_empty() {
                    models.push(SpiceModelDefinition {
                        name,
                        kind: SpiceModelKind::Subcircuit,
                        pins,
                    });
                }
                subcircuits.push(fields[1].to_owned());
            }
        } else if directive == ".ends" {
            let name = subcircuits
                .pop()
                .ok_or_else(|| ModelImportError::Invalid("unexpected .ends".into()))?;
            if fields
                .get(1)
                .is_some_and(|end| !end.eq_ignore_ascii_case(&name))
            {
                return Err(ModelImportError::Invalid(
                    ".ends does not match .subckt".into(),
                ));
            }
        }
    }
    if !subcircuits.is_empty() {
        return Err(ModelImportError::Invalid("missing .ends".into()));
    }
    models.sort_by_key(|model| model.name.to_ascii_lowercase());
    if models
        .windows(2)
        .any(|pair| pair[0].name.eq_ignore_ascii_case(&pair[1].name))
    {
        return Err(ModelImportError::Invalid(
            "duplicate exported model name".into(),
        ));
    }
    if models.is_empty() {
        Err(ModelImportError::NoModels)
    } else {
        Ok(models)
    }
}

pub fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-.+[]".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_intrinsic_and_subcircuit_models() {
        let source = "* vendor library\n.model 1N4148 D(Is=2n)\n.subckt OPA_TEST INP INM VCC VEE OUT\nR1 INP OUT 1k\n.ends OPA_TEST\n";
        let models = inspect(source).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[1].pins, vec!["INP", "INM", "VCC", "VEE", "OUT"]);
    }

    #[test]
    fn rejects_file_and_control_directives() {
        for source in [
            ".include /tmp/foreign.lib\n.model x D",
            ".control\nshell touch /tmp/nope\n.endc\n.model x D",
        ] {
            assert!(matches!(
                inspect(source),
                Err(ModelImportError::UnsafeDirective { .. })
            ));
        }
    }

    #[test]
    fn parses_continuations_and_keeps_local_models_private() {
        let result = inspect(".subckt FILTER IN\n+ OUT GND PARAMS: R=1k\n.model LOCAL D(Is=1n)\nR1 IN OUT {R}\n.ends FILTER").unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].pins, vec!["IN", "OUT", "GND"]);
        for bad in [
            ".subckt A IN OUT",
            ".ends A",
            ".model A D\n.model a D",
            ".subckt A IN OUT\n.ends B",
        ] {
            assert!(inspect(bad).is_err());
        }
    }

    #[test]
    fn rejects_tampered_embedded_library() {
        let mut library = import(Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../examples/models/learning.lib"
        )))
        .unwrap();
        library.content.push_str("\n* modified\n");
        assert!(validate_library(&library).is_err());
    }
}
