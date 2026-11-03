import type { devices } from "./devices.js";

export type HTDeviceType = keyof typeof devices;
export type HTWritableDeviceType = {
  [T in HTDeviceType]: keyof (typeof devices)[T]["commands"] extends never ? never : T;
}[HTDeviceType];
export type HTDeviceState = "NORMAL" | "INIT" | "UNKNOWN" | "ERROR";
export type HTWind = (typeof devices)["fan"]["commands"]["wind"][number];
export type HTAirconMode = (typeof devices)["aircon"]["commands"]["mode"][number];

export interface HTStatus {
  command: string;
  value: string;
}

export interface HTDevice<T extends HTDeviceType = HTDeviceType> {
  id: string;
  deviceType: T;
  deviceName: string;
  deviceLocation: string;
  state: HTDeviceState;
  deviceDetailName: string;
  statusList: HTStatus[];
}

export interface HTResponse {
  resultStatus: "success";
  transactionId?: string;
}

export interface HTDevicesResponse extends HTResponse {
  data: { deviceList: HTDevice[]; totalCount: number };
}

export interface HTDeviceStateResponse<T extends HTDeviceType = HTDeviceType> extends HTResponse {
  data: Pick<HTDevice<T>, "id" | "deviceType" | "deviceDetailName" | "state" | "statusList">;
}

export type HTStateResponse = HTResponse;
export type HTLightStateResponse = HTDeviceStateResponse<"light">;
export type HTFanStateResponse = HTDeviceStateResponse<"fan">;
export type HTHeatingStateResponse = HTDeviceStateResponse<"heating">;
export type HTAirconStateResponse = HTDeviceStateResponse<"aircon">;
export type HTWallSocketStateResponse = HTDeviceStateResponse<"wallsocket">;
export type HTMultiSwitchStateResponse = HTDeviceStateResponse<"multi_switch">;
export type HTGasStateResponse = HTDeviceStateResponse<"gas">;
export interface HTStatusPower extends HTStatus {
  command: "power";
  value: "on" | "off";
}

export interface HTDeviceQuery {
  deviceType?: HTDeviceType;
  includeStatus?: boolean;
}

/** Generic server metadata; names here need not equal wire command names. */
export interface HTProperty {
  type: string;
  name: string;
  valueType: string;
  readableValues?: string[];
  writableValues?: string[];
  valueNames?: Record<string, string>;
  readableMin?: number;
  readableMax?: number;
  writableMin?: number;
  writableMax?: number;
  step?: number;
}

export interface HTDevicePropertiesResponse extends HTResponse {
  data: {
    deviceList: { type: string; innerType: string; properties: Record<string, HTProperty> }[];
  };
}

export interface HTHouseholdResponse {
  resultCode: 100 | "100";
  resultMessage?: string;
  resultData: {
    danjiList: {
      siteId: string;
      siteName?: string;
      dong: string;
      ho: string;
      isApproved?: boolean;
      homepageDomain?: string;
      siteAddress?: string;
    }[];
  };
}
