import type {
  HTDevicesResponse,
  HTDeviceType,
  HTDeviceQuery,
  HTDeviceStateResponse,
  HTWritableDeviceType,
  HTStatus,
  HTDevicePropertiesResponse,
  HTLightStateResponse,
  HTFanStateResponse,
  HTHeatingStateResponse,
  HTAirconStateResponse,
  HTWallSocketStateResponse,
  HTMultiSwitchStateResponse,
  HTGasStateResponse,
  HTWind,
  HTAirconMode,
} from "./types.js";

/** Supported HT device queries and controls. */
export interface HTDeviceApi {
  getDevices(query?: HTDeviceQuery): Promise<HTDevicesResponse>;
  getDeviceProperties(): Promise<HTDevicePropertiesResponse>;
  getDeviceState<T extends HTDeviceType>(type: T, id: string): Promise<HTDeviceStateResponse<T>>;
  putDeviceCommands<T extends HTWritableDeviceType>(
    type: T,
    id: string,
    commands: readonly HTStatus[],
  ): Promise<HTDeviceStateResponse<T>>;
  getLightState(id: string): Promise<HTLightStateResponse>;
  putLightPower(id: string, power: boolean): Promise<HTLightStateResponse>;
  getFanState(id: string): Promise<HTFanStateResponse>;
  putFanPower(id: string, power: boolean): Promise<HTFanStateResponse>;
  putFanWind(id: string, wind: HTWind): Promise<HTFanStateResponse>;
  getHeaterState(id: string): Promise<HTHeatingStateResponse>;
  putHeaterPower(id: string, power: boolean): Promise<HTHeatingStateResponse>;
  putHeaterTemperature(id: string, temperature: number): Promise<HTHeatingStateResponse>;
  getAirconState(id: string): Promise<HTAirconStateResponse>;
  putAirconPower(id: string, power: boolean): Promise<HTAirconStateResponse>;
  putAirconTemperature(id: string, temperature: number): Promise<HTAirconStateResponse>;
  putAirconMode(id: string, mode: HTAirconMode): Promise<HTAirconStateResponse>;
  putAirconWind(id: string, wind: HTWind): Promise<HTAirconStateResponse>;
  getWallSocketState(id: string): Promise<HTWallSocketStateResponse>;
  putWallSocketPower(id: string, power: boolean): Promise<HTWallSocketStateResponse>;
  getMultiSwitchState(id: string): Promise<HTMultiSwitchStateResponse>;
  /** Activate lights-out; false restores the previous lighting state. */
  putMultiSwitchLightsOut(id: string, lightsOut: boolean): Promise<HTMultiSwitchStateResponse>;
  getGasState(id: string): Promise<HTGasStateResponse>;
  /** Close only; reopening requires local operation. */
  putGasClose(id: string): Promise<HTGasStateResponse>;
}
