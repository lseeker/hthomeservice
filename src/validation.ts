import type {
  HTDevice,
  HTDevicePropertiesResponse,
  HTDevicesResponse,
  HTDeviceStateResponse,
  HTDeviceType,
  HTStatus,
  HTHouseholdResponse,
} from "./types.js";

import { devices } from "./devices.js";

export class HTValidationError extends Error {}

function supportedType(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) {
    throw new HTValidationError("Invalid HT device type");
  }
  return Object.hasOwn(devices, value);
}

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HTValidationError("Invalid HT response object");
  }
  return value as Record<string, unknown>;
}

export function success(value: unknown) {
  const response = object(value);
  if (response.resultStatus !== "success") {
    throw new HTValidationError("HT service did not report success");
  }
  if (response.transactionId !== undefined && typeof response.transactionId !== "string") {
    throw new HTValidationError("Invalid HT transaction id");
  }
  return object(response.data);
}

export function householdResponse(value: unknown): HTHouseholdResponse {
  const response = object(value);
  if (response.resultCode !== 100 && response.resultCode !== "100") {
    throw new HTValidationError("HT household service did not report success");
  }
  if (response.resultMessage !== undefined && typeof response.resultMessage !== "string") {
    throw new HTValidationError("Invalid HT household message");
  }
  const data = object(response.resultData);
  if (!Array.isArray(data.danjiList)) {
    throw new HTValidationError("Invalid HT household list");
  }
  for (const entry of data.danjiList) {
    const household = object(entry);
    for (const field of ["siteId", "dong", "ho"]) {
      if (typeof household[field] !== "string" || !household[field].trim()) {
        throw new HTValidationError("Invalid HT household identity");
      }
    }
    if (household.isApproved !== undefined && typeof household.isApproved !== "boolean") {
      throw new HTValidationError("Invalid HT household approval");
    }
    for (const field of ["siteName", "homepageDomain", "siteAddress"]) {
      if (household[field] !== undefined && typeof household[field] !== "string") {
        throw new HTValidationError("Invalid HT household description");
      }
    }
  }
  return value as HTHouseholdResponse;
}

function statuses(value: unknown): asserts value is HTStatus[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => {
      const status = object(entry);
      return typeof status.command !== "string" || typeof status.value !== "string";
    })
  ) {
    throw new HTValidationError("Invalid HT status list");
  }
}

function deviceFields(d: Record<string, unknown>, full: boolean) {
  if (
    typeof d.id !== "string" ||
    !d.id.trim() ||
    typeof d.state !== "string" ||
    !["NORMAL", "INIT", "UNKNOWN", "ERROR"].includes(d.state)
  ) {
    throw new HTValidationError("Invalid HT device identity or state");
  }
  if (
    typeof d.deviceDetailName !== "string" ||
    (full && (typeof d.deviceName !== "string" || typeof d.deviceLocation !== "string"))
  ) {
    throw new HTValidationError("Invalid HT device description");
  }
  statuses(d.statusList);
}

export function devicesResponse(value: unknown): HTDevicesResponse {
  const data = success(value);
  if (
    !Array.isArray(data.deviceList) ||
    !Number.isInteger(data.totalCount) ||
    Number(data.totalCount) < 0
  ) {
    throw new HTValidationError("Invalid HT device list");
  }
  const identities = new Set<string>();
  const devices: HTDevice[] = [];
  for (const entry of data.deviceList) {
    const d = object(entry);
    if (!supportedType(d.deviceType)) {
      continue;
    }
    deviceFields(d, true);
    const identity = `${d.deviceType}:${d.id}`;
    if (identities.has(identity)) {
      throw new HTValidationError("Duplicate HT device identity");
    }
    identities.add(identity);
    devices.push(entry as HTDevice);
  }
  // totalCount is the server's count; only the returned list is filtered.
  return { ...object(value), data: { ...data, deviceList: devices } } as HTDevicesResponse;
}

export function stateResponse<T extends HTDeviceType>(
  value: unknown,
  type: T,
  id: string,
): HTDeviceStateResponse<T> {
  const data = success(value);
  if (!supportedType(data.deviceType)) {
    throw new HTValidationError("Invalid HT device identity or state");
  }
  deviceFields(data, false);
  if (data.id !== id || data.deviceType !== type) {
    throw new HTValidationError("HT device response identity does not match the request");
  }
  return value as HTDeviceStateResponse<T>;
}

export function propertiesResponse(value: unknown): HTDevicePropertiesResponse {
  const data = success(value);
  if (!Array.isArray(data.deviceList)) {
    throw new HTValidationError("Invalid HT device properties");
  }
  const devices: unknown[] = [];
  for (const entry of data.deviceList) {
    const d = object(entry);
    if (!supportedType(d.type)) {
      continue;
    }
    if (typeof d.innerType !== "string") {
      throw new HTValidationError("Invalid HT property device type");
    }
    for (const value of Object.values(object(d.properties))) {
      const p = object(value);
      if (
        typeof p.type !== "string" ||
        typeof p.name !== "string" ||
        typeof p.valueType !== "string"
      ) {
        throw new HTValidationError("Invalid HT property definition");
      }
      for (const field of ["writableMin", "writableMax", "readableMin", "readableMax", "step"]) {
        if (
          p[field] !== undefined &&
          (typeof p[field] !== "number" || !Number.isFinite(p[field]))
        ) {
          throw new HTValidationError("Invalid HT property range");
        }
      }
      for (const field of ["readableValues", "writableValues"]) {
        const values = p[field];
        if (
          values !== undefined &&
          (!Array.isArray(values) || values.some((entry) => typeof entry !== "string"))
        ) {
          throw new HTValidationError("Invalid HT property values");
        }
      }
      if (
        p.valueNames !== undefined &&
        Object.values(object(p.valueNames)).some((entry) => typeof entry !== "string")
      ) {
        throw new HTValidationError("Invalid HT property value names");
      }
    }
    devices.push(entry);
  }
  return { ...object(value), data: { ...data, deviceList: devices } } as HTDevicePropertiesResponse;
}
