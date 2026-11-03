import assert from "node:assert/strict";
import test from "node:test";
import { HTValidationError } from "@yylee/hthomeservice";
import {
  devicesResponse,
  stateResponse,
  propertiesResponse,
  householdResponse,
} from "../dist/validation.js";

const device = {
  id: "test",
  deviceType: "light",
  deviceName: "Light",
  deviceLocation: "Room",
  deviceDetailName: "Light",
  state: "NORMAL",
  statusList: [{ command: "power", value: "on" }],
};
const success = (data) => ({ resultStatus: "success", data });

test("device validation rejects invalid types, states and missing required fields", () => {
  for (const change of [
    { id: " " },
    { deviceType: null },
    { state: ["NORMAL"] },
    { state: "INVALID" },
    { deviceDetailName: undefined },
    { deviceDetailName: 123 },
    { statusList: [{ command: "power", value: true }] },
  ]) {
    const invalid = { ...device, ...change };
    assert.throws(
      () => devicesResponse(success({ totalCount: 1, deviceList: [invalid] })),
      HTValidationError,
    );
    assert.throws(() => stateResponse(success(invalid), "light", "test"), HTValidationError);
  }
  for (const change of [{ deviceName: undefined }, { deviceLocation: null }]) {
    assert.throws(
      () => devicesResponse(success({ totalCount: 1, deviceList: [{ ...device, ...change }] })),
      HTValidationError,
    );
  }
  assert.throws(
    () => devicesResponse(success({ totalCount: 2, deviceList: [device, device] })),
    /Duplicate/,
  );
  assert.throws(
    () => stateResponse({ ...success(device), transactionId: 1 }, "light", "test"),
    /transaction id/,
  );
});

test("device validation retains extra fields and accepts every supported type and state", () => {
  for (const deviceType of [
    "heating",
    "light",
    "gas",
    "aircon",
    "wallsocket",
    "multi_switch",
    "fan",
  ]) {
    for (const state of ["NORMAL", "INIT", "UNKNOWN", "ERROR"]) {
      const data = { ...device, deviceType, state, extension: "preserved", statusList: [] };
      const response = success(data);
      assert.equal(stateResponse(response, deviceType, "test"), response);
      assert.equal(
        devicesResponse(success({ totalCount: 1, deviceList: [data] })).data.deviceList[0],
        data,
      );
    }
  }
});

test("unsupported device types are ignored before validating their unfamiliar payloads", () => {
  const unknown = { deviceType: "future-device", state: "NEW_STATE", statusList: null };
  const response = {
    ...success({ totalCount: 3, deviceList: [unknown, device, unknown], extension: true }),
    transactionId: "transaction",
  };
  const filtered = devicesResponse(response);
  assert.deepEqual(filtered.data.deviceList, [device]);
  assert.equal(filtered.data.totalCount, 3);
  assert.equal(filtered.data.extension, true);
  assert.equal(filtered.transactionId, "transaction");
  assert.equal(response.data.deviceList.length, 3);
  assert.deepEqual(
    devicesResponse(success({ totalCount: 1, deviceList: [unknown] })).data.deviceList,
    [],
  );
  assert.throws(
    () => stateResponse(success({ ...device, deviceType: "future-device" }), "light", "test"),
    HTValidationError,
  );
  assert.throws(
    () =>
      devicesResponse(
        success({ totalCount: 2, deviceList: [unknown, { ...device, state: "BAD" }] }),
      ),
    HTValidationError,
  );
});

test("unsupported property types are ignored without inspecting their property schema", () => {
  const known = { type: "light", innerType: "light", properties: {} };
  const unknown = { type: "future-device", properties: null };
  const response = success({ deviceList: [unknown, known], extension: true });
  assert.deepEqual(propertiesResponse(response).data, { deviceList: [known], extension: true });
  assert.equal(response.data.deviceList.length, 2);
  assert.deepEqual(propertiesResponse(success({ deviceList: [unknown] })).data.deviceList, []);
  assert.throws(
    () => propertiesResponse(success({ deviceList: [{ type: null }] })),
    HTValidationError,
  );
});

test("household validation checks success and identity while accepting omitted optional metadata", () => {
  const household = { siteId: "site", dong: "101", ho: "1001" };
  const response = { resultCode: "100", resultData: { danjiList: [household] } };
  assert.equal(householdResponse(response), response);
  assert.equal(householdResponse({ ...response, resultCode: 100 }).resultCode, 100);
  for (const invalid of [
    null,
    { ...response, resultCode: "500" },
    { ...response, resultCode: 101 },
    { resultCode: "100" },
    { resultCode: "100", resultData: { danjiList: {} } },
    { ...response, resultMessage: false },
    ...[
      { siteId: " " },
      { dong: 101 },
      { ho: undefined },
      { isApproved: "true" },
      { siteName: null },
      { homepageDomain: [] },
      { siteAddress: 1 },
    ].map((change) => ({
      resultCode: "100",
      resultData: { danjiList: [{ ...household, ...change }] },
    })),
  ]) {
    assert.throws(() => householdResponse(invalid), HTValidationError);
  }
});

test("property validation checks optional enums and labels without dropping extension data", () => {
  const property = { type: "control", name: "Power", valueType: "string", extension: true };
  const response = (changes) =>
    success({
      deviceList: [
        { type: "light", innerType: "light", properties: { power: { ...property, ...changes } } },
      ],
    });
  const valid = response({
    readableValues: [],
    writableValues: ["on", "off"],
    valueNames: { on: "On" },
  });
  assert.deepEqual(propertiesResponse(valid), valid);
  for (const invalid of [
    { readableValues: "on" },
    { readableValues: [false] },
    { writableValues: [1] },
    { valueNames: [] },
    { valueNames: null },
    { valueNames: { on: true } },
    { writableMin: "5" },
    { step: Infinity },
  ]) {
    assert.throws(() => propertiesResponse(response(invalid)), HTValidationError);
  }
});

test("elevator and event sender responses are excluded from supported devices and metadata", () => {
  const unsupported = ["elevator", "eventsender"];
  const response = devicesResponse(
    success({
      totalCount: 3,
      deviceList: [
        device,
        ...unsupported.map((deviceType) => ({ deviceType, state: "INIT", statusList: [] })),
      ],
    }),
  );
  assert.deepEqual(response.data.deviceList, [device]);
  assert.equal(response.data.totalCount, 3);
  assert.deepEqual(
    propertiesResponse(
      success({ deviceList: unsupported.map((type) => ({ type, properties: {} })) }),
    ).data.deviceList,
    [],
  );
});
