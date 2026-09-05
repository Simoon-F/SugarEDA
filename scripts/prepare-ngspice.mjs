import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const source = process.argv[2] || process.env.SUGAREDA_NGSPICE_BUNDLE_SOURCE;
if (!source)
  throw new Error(
    "Pass a trusted ngspice executable/payload directory or set SUGAREDA_NGSPICE_BUNDLE_SOURCE",
  );
const platforms = {
  "darwin-arm64": "macos-aarch64",
  "darwin-x64": "macos-x86_64",
  "win32-x64": "windows-x86_64",
  "win32-arm64": "windows-aarch64",
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-aarch64",
};
const target = platforms[`${process.platform}-${process.arch}`];
if (!target)
  throw new Error(
    `Unsupported release target ${process.platform}-${process.arch}`,
  );
const sourcePath = resolve(source);
const name = process.platform === "win32" ? "ngspice.exe" : "ngspice";
const sourceIsDirectory = statSync(sourcePath).isDirectory();
const executable = sourceIsDirectory ? join(sourcePath, name) : sourcePath;
const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0)
  throw new Error(
    `ngspice verification failed for ${basename(executable)}: ${probe.error?.message || probe.stderr}`,
  );
const destinationDirectory = resolve(
  "src-tauri",
  "resources",
  "ngspice",
  target,
);
const destination = join(destinationDirectory, name);
mkdirSync(destinationDirectory, { recursive: true });
if (sourceIsDirectory) {
  for (const entry of readdirSync(sourcePath)) {
    cpSync(join(sourcePath, entry), join(destinationDirectory, entry), {
      recursive: true,
      force: true,
    });
  }
} else {
  copyFileSync(executable, destination);
}
if (process.platform !== "win32") chmodSync(destination, 0o755);
console.log(
  `Prepared ${target}/${name}: ${(probe.stdout || probe.stderr).split("\n").find(Boolean)}`,
);
