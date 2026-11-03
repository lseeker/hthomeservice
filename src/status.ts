import type { HTStatus } from "./types.js";
import { HTValidationError } from "./validation.js";

export function statusValue(device: { statusList: HTStatus[] }, command: string): string {
  const value = device.statusList.find((status) => status.command === command)?.value;
  if (value === undefined) {
    throw new HTValidationError(`Missing device status: ${command}`);
  }
  return value;
}

export function statusNumber(device: { statusList: HTStatus[] }, command: string): number {
  const raw = statusValue(device, command);
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value)) {
    throw new HTValidationError(`Invalid numeric device status: ${command}`);
  }
  return value;
}

export function statusOn(device: { statusList: HTStatus[] }, command = "power"): boolean {
  const value = statusValue(device, command);
  if (value !== "on" && value !== "off") {
    throw new HTValidationError(`Invalid on/off device status: ${command}`);
  }
  return value === "on";
}

export function statusDetected(device: { statusList: HTStatus[] }, command: string): boolean {
  const value = statusValue(device, command);
  if (value !== "detected" && value !== "undetected") {
    throw new HTValidationError(`Invalid detection device status: ${command}`);
  }
  return value === "detected";
}
