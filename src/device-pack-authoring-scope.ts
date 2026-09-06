import type { DevicePack } from "./types";

export type AuthoredDevice = DevicePack["devices"][number];

export function authoredDevice(
  pack: DevicePack,
  deviceId?: string,
): AuthoredDevice {
  const device = deviceId
    ? pack.devices.find((candidate) => candidate.id === deviceId)
    : pack.devices[0];
  if (!device)
    throw new Error(`Unknown authored device: ${deviceId ?? "<first>"}`);
  return device;
}

export function replaceAuthoredDevice(
  pack: DevicePack,
  device: AuthoredDevice,
): DevicePack {
  return {
    ...pack,
    devices: pack.devices.map((candidate) =>
      candidate.id === device.id ? device : candidate,
    ),
  };
}

export function replaceAuthoredDeviceById(
  pack: DevicePack,
  deviceId: string | undefined,
  device: AuthoredDevice,
): DevicePack {
  const current = authoredDevice(pack, deviceId);
  return {
    ...pack,
    devices: pack.devices.map((candidate) =>
      candidate === current ? device : candidate,
    ),
  };
}

export function authoredSymbol(pack: DevicePack, deviceId?: string) {
  const device = authoredDevice(pack, deviceId);
  const symbol = pack.symbols.find(
    (candidate) => candidate.id === device.symbolId,
  );
  if (!symbol) throw new Error(`Unknown authored symbol: ${device.symbolId}`);
  return symbol;
}

export function uniqueAuthoredId(
  preferred: string,
  used: Iterable<string>,
): string {
  const ids = new Set(used);
  if (!ids.has(preferred)) return preferred;
  let suffix = 2;
  while (ids.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}
