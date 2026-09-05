fn main() {
    println!("cargo:rerun-if-changed=resources/ngspice");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let os = std::env::var("CARGO_CFG_TARGET_OS").expect("target OS");
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture");
        let filename = if os == "windows" {
            "ngspice.exe"
        } else {
            "ngspice"
        };
        let payload = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/ngspice")
            .join(format!("{os}-{arch}"))
            .join(filename);
        assert!(payload.is_file(), "Release requires bundled ngspice at {}. Run pnpm build:ngspice (macOS/Linux) or pnpm prepare:ngspice with a native self-contained payload first.", payload.display());
    }
    tauri_build::build()
}
