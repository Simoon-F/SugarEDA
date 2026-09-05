import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const validateVersion = (version) => {
  if (!version || !semverPattern.test(version)) {
    throw new Error(
      "Version must be SemVer without a leading v, for example 1.2.3 or 1.3.0-beta.1.",
    );
  }

  const prerelease = version.split("+", 1)[0].split("-").slice(1).join("-");
  if (
    prerelease
      .split(".")
      .some(
        (identifier) =>
          /^\d+$/.test(identifier) &&
          identifier.length > 1 &&
          identifier.startsWith("0"),
      )
  ) {
    throw new Error(
      `Version contains a numeric prerelease identifier with a leading zero: ${version}.`,
    );
  }
};

const parseSemver = (version) => {
  const [withoutBuild] = version.split("+", 1);
  const separator = withoutBuild.indexOf("-");
  const core = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
  const prerelease =
    separator < 0 ? [] : withoutBuild.slice(separator + 1).split(".");
  return { core: core.split(".").map(Number), prerelease };
};

const compareSemver = (leftVersion, rightVersion) => {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1;
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }

  const identifierCount = Math.max(
    left.prerelease.length,
    right.prerelease.length,
  );
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
};

const readJson = async (workspaceRoot, relativePath) =>
  JSON.parse(await readFile(path.join(workspaceRoot, relativePath), "utf8"));

const writeJson = async (workspaceRoot, relativePath, value) => {
  await writeFile(
    path.join(workspaceRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
};

const readMatchedVersion = async (workspaceRoot, relativePath, pattern) => {
  const contents = await readFile(
    path.join(workspaceRoot, relativePath),
    "utf8",
  );
  const match = contents.match(pattern);
  if (!match) throw new Error(`Could not find version in ${relativePath}.`);
  return match[1];
};

const updateMatchedVersion = async (
  workspaceRoot,
  relativePath,
  pattern,
  version,
) => {
  const filePath = path.join(workspaceRoot, relativePath);
  const current = await readFile(filePath, "utf8");
  let matchCount = 0;
  const next = current.replace(pattern, (_match, prefix, suffix) => {
    matchCount += 1;
    return `${prefix}${version}${suffix}`;
  });
  if (matchCount !== 1) {
    throw new Error(
      `Expected one project version in ${relativePath}, found ${matchCount}.`,
    );
  }
  await writeFile(filePath, next);
};

export const setBuildVersion = async (workspaceRoot, version) => {
  validateVersion(version);

  const packageManifest = await readJson(workspaceRoot, "package.json");
  const tauriConfig = await readJson(
    workspaceRoot,
    "src-tauri/tauri.conf.json",
  );
  const cargoVersion = await readMatchedVersion(
    workspaceRoot,
    "src-tauri/Cargo.toml",
    /\[package\][\s\S]*?\nversion = "([^"]+)"/,
  );
  const currentVersions = [
    packageManifest.version,
    tauriConfig.version,
    cargoVersion,
  ];
  currentVersions.forEach(validateVersion);
  const currentVersion = currentVersions.reduce((latest, candidate) =>
    compareSemver(candidate, latest) > 0 ? candidate : latest,
  );
  if (compareSemver(version, currentVersion) < 0) {
    throw new Error(
      `Version ${version} is older than the current project version ${currentVersion}.`,
    );
  }

  packageManifest.version = version;
  await writeJson(workspaceRoot, "package.json", packageManifest);

  const packageLock = await readJson(workspaceRoot, "package-lock.json");
  if (!packageLock.packages?.[""]) {
    throw new Error("Could not find the root package in package-lock.json.");
  }
  packageLock.version = version;
  packageLock.packages[""].version = version;
  await writeJson(workspaceRoot, "package-lock.json", packageLock);

  tauriConfig.version = version;
  await writeJson(workspaceRoot, "src-tauri/tauri.conf.json", tauriConfig);

  await updateMatchedVersion(
    workspaceRoot,
    "src-tauri/Cargo.toml",
    /(\[package\][\s\S]*?\nversion = ")[^"]+(")/,
    version,
  );
  await updateMatchedVersion(
    workspaceRoot,
    "src-tauri/Cargo.lock",
    /(\[\[package\]\]\nname = "sugareda"\nversion = ")[^"]+(")/,
    version,
  );
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const args = process.argv.slice(2);
  const validateOnly = args[0] === "--validate-only";
  const version = args[validateOnly ? 1 : 0] ?? process.env.RELEASE_VERSION;
  validateVersion(version);
  if (validateOnly) {
    console.log(`Validated SugarEDA release version ${version}.`);
  } else {
    const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");
    await setBuildVersion(workspaceRoot, version);
    console.log(`Updated SugarEDA build version to ${version}.`);
  }
}
