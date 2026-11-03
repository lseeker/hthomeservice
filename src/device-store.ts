import type { HTDeviceApi } from "./device-api.js";
import type {
  HTDevice,
  HTDevicePropertiesResponse,
  HTDeviceType,
  HTStatus,
  HTWritableDeviceType,
} from "./types.js";
import { HTValidationError } from "./validation.js";

/** Shared per-type snapshots: one list request serves all devices and characteristics of a type. */
export class HTDeviceStore {
  private readonly cache = new Map<HTDeviceType, { expires: number; devices: HTDevice[] }>();
  private readonly pending = new Map<HTDeviceType, Promise<HTDevice[]>>();
  private readonly revisions = new Map<HTDeviceType, number>();
  private readonly writes = new Map<string, Promise<unknown>>();
  private properties?: HTDevicePropertiesResponse;

  constructor(
    private readonly api: HTDeviceApi,
    private readonly ttlMs = 5000,
  ) {}

  public setProperties(properties: HTDevicePropertiesResponse) {
    this.properties = properties;
  }

  public temperatureRange(type: HTDeviceType) {
    const property = this.properties?.data.deviceList.find((entry) => entry.type === type)
      ?.properties.setTemperature;
    const minValue = Math.max(5, property?.writableMin ?? 5);
    const maxValue = Math.min(40, property?.writableMax ?? 40);
    const minStep = property?.step ?? 1;
    if (
      minValue > maxValue ||
      minStep !== 1 ||
      !Number.isInteger(minValue) ||
      !Number.isInteger(maxValue)
    ) {
      throw new HTValidationError("Unsupported temperature range metadata");
    }
    return { minValue, maxValue, minStep };
  }

  public invalidate(type: HTDeviceType) {
    this.revisions.set(type, (this.revisions.get(type) ?? 0) + 1);
    this.cache.delete(type);
    this.pending.delete(type);
  }

  private async list(type: HTDeviceType): Promise<HTDevice[]> {
    const cached = this.cache.get(type);
    if (cached && cached.expires > Date.now()) {
      return cached.devices;
    }
    const existing = this.pending.get(type);
    if (existing) {
      return existing;
    }
    const revision = this.revisions.get(type) ?? 0;
    const request = this.api
      .getDevices({ deviceType: type, includeStatus: true })
      .then((response) => {
        // A read started before a write must not restore or return stale pre-command state.
        if (revision !== (this.revisions.get(type) ?? 0)) {
          return this.list(type);
        }
        const devices = response.data.deviceList.filter((device) => device.deviceType === type);
        this.cache.set(type, { expires: Date.now() + this.ttlMs, devices });
        return devices;
      })
      .finally(() => {
        if (this.pending.get(type) === request) {
          this.pending.delete(type);
        }
      });
    this.pending.set(type, request);
    return request;
  }

  public async read(type: HTDeviceType, id: string): Promise<HTDevice> {
    const device = (await this.list(type)).find((entry) => entry.id === id);
    if (!device || device.state === "ERROR") {
      throw new HTValidationError("Device is missing or reports a communication error");
    }
    return device;
  }

  public async write(
    type: HTWritableDeviceType,
    id: string,
    commands: readonly HTStatus[],
  ): Promise<HTDevice> {
    const key = `${type}:${id}`;
    const previous = this.writes.get(key) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read(type, id);
        if (current.state !== "NORMAL") {
          throw new HTValidationError("Device control requires a NORMAL device state");
        }
        for (const command of commands) {
          if (command.command === "setTemperature") {
            const range = this.temperatureRange(type);
            const temperature = Number(command.value);
            if (
              !command.value.trim() ||
              !Number.isInteger(temperature) ||
              temperature < range.minValue ||
              temperature > range.maxValue
            ) {
              throw new HTValidationError("Temperature is outside the allowed device range");
            }
          }
        }
        this.invalidate(type);
        try {
          await this.api.putDeviceCommands(type, id, commands);
        } finally {
          // Invalidate even after partial failure: one of several sequential commands may have succeeded.
          this.invalidate(type);
        }
        return this.read(type, id);
      });
    this.writes.set(key, task);
    try {
      return await task;
    } finally {
      if (this.writes.get(key) === task) {
        this.writes.delete(key);
      }
    }
  }
}
