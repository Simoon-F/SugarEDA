use std::{io::Write, path::Path};

pub fn csv(path: &Path, content: &str) -> Result<(), String> {
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
    {
        return Err("Waveform export requires a .csv file".into());
    }
    if content.len() > 64 * 1024 * 1024 {
        return Err("CSV export exceeds 64 MiB".into());
    }
    let parent = path.parent().ok_or("Invalid export path")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}
