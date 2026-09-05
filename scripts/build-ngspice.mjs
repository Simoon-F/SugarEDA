import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// A minimal analog engine: no X11, readline, dynamically loaded code models,
// or Homebrew paths. This is the profile exercised by SugarEDA's integration suite.
const version = "47";
const checksum =
  "894e649651f1838a14095e5a5439e7d3aa63e87ede14d283173fda4fcdef675f";
const sourceUrl = `https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/${version}/ngspice-${version}.tar.gz`;
const root = resolve(import.meta.dirname, "..");
if (process.platform === "win32") {
  throw new Error(
    "Windows source builds are not yet verified. Use prepare:ngspice with a trusted self-contained Windows payload including its DLLs and notices.",
  );
}
const work = mkdtempSync(join(tmpdir(), "sugareda-ngspice-build-"));
function run(command, args, cwd = work) {
  const log = openSync(join(work, "build.log"), "a");
  console.log(`Running ${command}; details: ${join(work, "build.log")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  closeSync(log);
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error || result.status}. Build retained at ${work}`,
    );
}
console.log(`Building ngspice ${version} in ${work}`);
const archive = join(work, "ngspice.tar.gz");
run("curl", [
  "--fail",
  "--location",
  "--retry",
  "3",
  "--output",
  archive,
  sourceUrl,
]);
if (
  createHash("sha256").update(readFileSync(archive)).digest("hex") !== checksum
)
  throw new Error("ngspice source checksum mismatch");
run("tar", ["-xzf", archive]);
const source = join(work, `ngspice-${version}`);
run(
  "bash",
  [
    "./configure",
    "--with-x=no",
    "--with-readline=no",
    "--enable-xspice",
    "--disable-cider",
    "--disable-openmp",
    "--disable-debug",
  ],
  source,
);
run("make", ["-j4"], source);
const payload = join(work, "payload");
mkdirSync(payload);
const executable = process.platform === "win32" ? "ngspice.exe" : "ngspice";
copyFileSync(join(source, "src", executable), join(payload, executable));
mkdirSync(join(payload, "licenses"));
for (const file of readdirSync(source)) {
  if (/^(COPYING|COPYRIGHT|AUTHORS|LICENSE)/i.test(file))
    copyFileSync(join(source, file), join(payload, "licenses", file));
}
writeFileSync(
  join(payload, "source.json"),
  JSON.stringify(
    {
      version,
      sourceUrl,
      sourceSha256: checksum,
      profile:
        "headless analog; no X11/readline/CIDER/OpenMP; XSPICE kernel compiled, external code models not packaged",
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
run(
  process.execPath,
  [join(root, "scripts", "prepare-ngspice.mjs"), payload],
  root,
);
console.log(`Build sources retained for reproducibility: ${source}`);
