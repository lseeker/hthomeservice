// Based on read-only responses observed on 2026-11-02.
// Identifiers and display names are synthetic. PUT responses are not represented here.
const statuses = (values) => Object.entries(values).map(([command, value]) => ({ command, value }));

export const observedStates = {
  light: { state: "NORMAL", statusList: statuses({ power: "off" }) },
  heating: {
    state: "NORMAL",
    statusList: statuses({
      power: "off",
      reservationType: "none",
      mode: "in",
      errorCode: "0",
      currTemperature: "23",
      setTemperature: "10",
      flowValveOpenClose: "close",
    }),
  },
  fan: {
    state: "NORMAL",
    statusList: statuses({
      power: "on",
      wind: "light",
      mode: "none",
      offReservation: "false",
      operationTime: "0",
    }),
  },
  wallsocket: {
    state: "NORMAL",
    statusList: statuses({ power: "on", sleep: "on", currentWatt: "0", blockWatt: "0" }),
  },
  gas: {
    state: "NORMAL",
    statusList: statuses({ power: "on", gas: "undetected", fire: "undetected" }),
  },
  multi_switch: { state: "NORMAL", statusList: statuses({ light: "off", gas: "on" }) },
  elevator: { state: "INIT", statusList: [] },
  eventsender: { state: "INIT", statusList: [] },
  aircon: {
    state: "UNKNOWN",
    statusList: statuses({
      power: "off",
      mode: "airwash",
      wind: "pow",
      setTemperature: "26",
      currTemperature: "27",
    }),
  },
};

export function observedDevice(type, id = `${type}-test`) {
  return {
    id,
    deviceType: type,
    deviceName: "Test device",
    deviceLocation: "Test room",
    deviceDetailName: "Test detail",
    ...structuredClone(observedStates[type]),
  };
}

export function observedList(type, includeStatus = false) {
  const types = type ? [type] : Object.keys(observedStates);
  const deviceList = types.map((type) => observedDevice(type));
  if (!includeStatus) {
    for (const device of deviceList) device.statusList = [];
  }
  return { resultStatus: "success", data: { totalCount: deviceList.length, deviceList } };
}

export function observedState(type, id) {
  const { deviceName: _name, deviceLocation: _location, ...data } = observedDevice(type, id);
  // The individual fan response omitted the extra fields present in the batch response.
  if (type === "fan")
    data.statusList = data.statusList.filter((s) => ["power", "wind"].includes(s.command));
  return { resultStatus: "success", data };
}

const list = (name, readableValues, writableValues, valueNames) => ({
  type: "list",
  name,
  valueType: "string",
  readableValues,
  ...(writableValues ? { writableValues } : {}),
  ...(valueNames ? { valueNames } : {}),
});
const power = list("전원", ["on", "off"], ["on", "off"]);
const targetTemperature = {
  type: "range",
  name: "설정온도",
  valueType: "integer",
  readableMin: 5,
  readableMax: 40,
  writableMin: 5,
  writableMax: 40,
  step: 1,
};
const currentTemperature = {
  type: "range",
  name: "현재온도",
  valueType: "integer",
  readableMin: 5,
  readableMax: 40,
};
const property = (type, properties) => ({ type, innerType: type, properties });

export function observedProperties() {
  return {
    resultStatus: "success",
    data: {
      deviceList: [
        property("light", { power }),
        property("heating", { power, setTemperature: targetTemperature, currentTemperature }),
        property("aircon", {
          power,
          mode: list(
            "냉방모드",
            ["auto", "cooling", "airwash", "dehumidify", "heating"],
            ["auto", "cooling", "airwash", "dehumidify", "heating"],
          ),
          level: list(
            "풍량",
            ["stop", "auto", "light", "middle", "strong"],
            ["auto", "light", "middle", "strong"],
          ),
          setTemperature: targetTemperature,
          currentTemperature,
        }),
        property("fan", {
          power,
          level: list(
            "풍량",
            ["stop", "light", "middle", "strong", "auto"],
            ["light", "middle", "strong", "auto"],
          ),
        }),
        property("wallsocket", {
          power,
          sleepMode: list("슬립모드", ["on", "off"], ["on", "off"], {
            off: "꺼짐(수동모드)",
            on: "켜짐(자동모드)",
          }),
        }),
        property("gas", {
          power: list("가스밸브상태", ["on", "off"], ["on"], { off: "열림", on: "닫힘" }),
          gasDetection: list("가스 누출 여부", ["detected", "undetected"]),
          fireDetection: list("화재 발생 여부", ["detected", "undetected"]),
        }),
        property("multi_switch", {
          light: list("일괄소등", ["on", "off"], ["on", "off"], { on: "소등", off: "점등" }),
          gas: list("가스차단", ["on", "off"], ["off"]),
        }),
        property("curtain", { openClose: list("개폐", ["open", "close"], ["open", "close"]) }),
      ],
    },
  };
}
