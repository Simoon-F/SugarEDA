import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const platform = process.platform;

if (platform === "darwin" && !process.env.SUGAREDA_ALLOW_UNSUPPORTED_DRIVER) {
  console.log(
    "Desktop E2E skipped: tauri-driver supports Linux and Windows. Run this test on a Linux/Windows desktop CI runner.",
  );
  process.exit(0);
}

const defaultBinary =
  platform === "win32"
    ? "src-tauri/target/debug/sugareda.exe"
    : "src-tauri/target/debug/sugareda";
const application = path.resolve(
  process.env.SUGAREDA_DESKTOP_BINARY || defaultBinary,
);
await access(application).catch(() => {
  throw new Error(
    `Desktop binary not found at ${application}. Run npm run test:desktop:build first.`,
  );
});

const port = Number(process.env.TAURI_DRIVER_PORT || 4444);
const baseUrl = `http://127.0.0.1:${port}`;
let driverOutput = "";
let driverError;
const driver = spawn("tauri-driver", ["--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
});
driver.stdout.on("data", (chunk) => (driverOutput += chunk));
driver.stderr.on("data", (chunk) => (driverOutput += chunk));
driver.on("error", (error) => {
  driverError = error;
});

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error)
    throw new Error(
      `WebDriver ${method} ${endpoint} failed: ${JSON.stringify(payload)}`,
    );
  return payload.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await request("GET", "/status");
      return;
    } catch {
      if (driverError) throw driverError;
      if (driver.exitCode !== null)
        throw new Error(`tauri-driver exited early:\n${driverOutput}`);
      await pause(100);
    }
  }
  throw new Error(`tauri-driver did not become ready:\n${driverOutput}`);
}

async function waitForElement(sessionId, selector) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await request("POST", `/session/${sessionId}/element`, {
        using: "css selector",
        value: selector,
      });
    } catch {
      await pause(100);
    }
  }
  throw new Error(`Element did not appear: ${selector}`);
}

async function click(sessionId, selector) {
  const element = await waitForElement(sessionId, selector);
  await request(
    "POST",
    `/session/${sessionId}/element/${element[elementKey]}/click`,
    {},
  );
}

async function text(sessionId, selector) {
  const element = await waitForElement(sessionId, selector);
  return request(
    "GET",
    `/session/${sessionId}/element/${element[elementKey]}/text`,
  );
}

async function waitForText(sessionId, selector, pattern) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await text(sessionId, selector);
    if (pattern.test(value)) return value;
    await pause(100);
  }
  throw new Error(`Text ${pattern} did not appear in ${selector}`);
}

let sessionId;
try {
  await waitForDriver();
  const session = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        "tauri:options": { application },
      },
    },
  });
  sessionId = session.sessionId;

  await waitForElement(sessionId, '[data-testid="app-shell"]');
  await click(sessionId, '[data-testid="library-resistor"]');
  await click(sessionId, '[data-testid="schematic-canvas"]');
  await waitForText(
    sessionId,
    '[data-testid="project-state"]',
    /Modified|已修改|Recovery saved|恢复副本/,
  );

  // Wait for the debounced Rust-side recovery write, then exercise the
  // three-way unsaved-changes guard through the real desktop WebView.
  await waitForText(
    sessionId,
    '[data-testid="project-state"]',
    /Recovery saved|恢复副本已保存/,
  );
  await click(sessionId, '[data-testid="file-menu"]');
  await click(sessionId, '[data-testid="file-new"]');
  await waitForElement(sessionId, '[data-testid="unsaved-dialog"]');
  await click(sessionId, '[data-testid="cancel-transition"]');

  console.log("Desktop E2E passed: launch, edit, autosave, and unsaved guard.");
} finally {
  if (sessionId)
    await request("DELETE", `/session/${sessionId}`).catch(() => undefined);
  driver.kill("SIGTERM");
}
