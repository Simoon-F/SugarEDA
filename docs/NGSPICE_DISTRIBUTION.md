# ngspice distribution

Resolution: explicit UI path, SUGAREDA_NGSPICE_PATH, packaged resource, then PATH. Prepared installers require no separate user installation.

## Native macOS/Linux source build

```sh
pnpm build:ngspice
pnpm tauri build
```

Requires Node 22+, bash, curl, tar, make, and C/C++ compiler. The builder downloads ngspice 47 and verifies pinned SHA-256 before extraction. It builds a headless profile without X11, readline, CIDER, or OpenMP. The XSPICE kernel is compiled, but external code-model libraries are not packaged or supported by the importer.

The payload contains the executable, upstream root licenses/notices, and source.json with version, original source URL, archive hash, profile, and build timestamp. Temporary sources/build logs are retained; their paths are printed. This is pinned-source provenance, not a claim of bit-for-bit reproducibility.

The local macOS arm64 binary was checked with otool -L: only system libSystem and libc++ dependencies. The debug .app contains this binary. Intel macOS/Linux are not yet natively verified.

## Windows / externally prepared payloads

```sh
pnpm prepare:ngspice /trusted/self-contained-payload-directory
pnpm tauri build
```

The directory must contain ngspice.exe, every required runtime DLL, and distribution notices. It must match the native release runner's architecture. The copy/probe script does not resolve dependencies automatically. A Homebrew binary copied alone is likewise not a portable macOS payload.

Windows source compilation is not yet automated/verified here. The resource resolver supports macOS/Windows/Linux platform and architecture directories, but directory support alone is not a clean-machine release test.

## Release gate

Before publishing: verify architecture and dependency closure, test without developer PATH/Homebrew/MSYS libraries, run real solver integration tests against the packaged executable, review all included third-party license/source obligations, then sign/package on the native platform.

```sh
SUGAREDA_REQUIRE_NGSPICE=1 SUGAREDA_NGSPICE_PATH=/absolute/path/to/packaged/ngspice cargo test --manifest-path src-tauri/Cargo.toml
```

The mandatory flag makes a missing solver fail tests rather than skip them. Source-built notices/provenance are included, but no public distribution audit or Windows release validation is claimed.
