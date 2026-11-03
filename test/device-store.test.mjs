import assert from "node:assert/strict";
import test from "node:test";
import { HTDeviceStore, statusNumber, statusOn, statusValue } from "@yylee/hthomeservice";

function device(type = "light", power = "off", state = "NORMAL") {
  return {
    id: "test",
    deviceType: type,
    deviceName: "test",
    deviceLocation: "test",
    state,
    deviceDetailName: "test",
    statusList: [{ command: "power", value: power }],
  };
}
const response = (d) => ({ resultStatus: "success", data: { deviceList: [d], totalCount: 1 } });

test("all devices and characteristics of one type share one snapshot request", async () => {
  let reads = 0;
  const api = {
    getDevices: async (query) => {
      reads++;
      assert.deepEqual(query, { deviceType: "light", includeStatus: true });
      return response(device());
    },
  };
  const store = new HTDeviceStore(api);
  await Promise.all(Array.from({ length: 20 }, () => store.read("light", "test")));
  await store.read("light", "test");
  assert.equal(reads, 1);
});

test("read failure is not cached and a missing device never becomes a false OFF value", async () => {
  let reads = 0;
  const api = {
    getDevices: async () => {
      if (++reads === 1) {
        throw new Error("offline");
      }
      return response(device());
    },
  };
  const store = new HTDeviceStore(api);
  await assert.rejects(store.read("light", "test"), /offline/);
  assert.equal(statusOn(await store.read("light", "test")), false);
  await assert.rejects(store.read("light", "missing"), /missing/);
  assert.equal(reads, 2);
});

test("an old snapshot completing after a write returns the fresh state instead", async () => {
  let release;
  let reads = 0;
  let current = device();
  const api = {
    getDevices: async () => {
      if (++reads === 1) {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return response(current);
    },
    putDeviceCommands: async () => {
      current = device("light", "on");
    },
  };
  const store = new HTDeviceStore(api);
  const old = store.read("light", "test");
  store.invalidate("light");
  await store.write("light", "test", [{ command: "power", value: "on" }]);
  release(response(device()));
  assert.equal(statusOn(await old), true);
  assert.equal(statusOn(await store.read("light", "test")), true);
});

test("writes on one device are serialized and failures do not block the next command", async () => {
  const order = [];
  let current = device();
  const api = {
    getDevices: async () => response(current),
    putDeviceCommands: async (type, id, commands) => {
      const value = commands[0].value;
      order.push(value);
      if (value === "on") {
        throw new Error("failed");
      }
      current = device("light", value);
    },
  };
  const store = new HTDeviceStore(api);
  const first = assert.rejects(
    store.write("light", "test", [{ command: "power", value: "on" }]),
    /failed/,
  );
  const second = store.write("light", "test", [{ command: "power", value: "off" }]);
  await Promise.all([first, second]);
  assert.deepEqual(order, ["on", "off"]);
});

test("UNKNOWN remains readable with status but cannot issue control commands", async () => {
  let writes = 0;
  const store = new HTDeviceStore({
    getDevices: async () => response(device("aircon", "off", "UNKNOWN")),
    putDeviceCommands: async () => {
      writes++;
    },
  });
  assert.equal((await store.read("aircon", "test")).state, "UNKNOWN");
  await assert.rejects(
    store.write("aircon", "test", [{ command: "power", value: "on" }]),
    /NORMAL/,
  );
  assert.equal(writes, 0);
});

test("metadata narrows temperature bounds without changing raw command names", async () => {
  let writes = 0;
  const store = new HTDeviceStore({
    getDevices: async () => response(device("heating")),
    putDeviceCommands: async () => {
      writes++;
    },
  });
  store.setProperties({
    data: {
      deviceList: [
        {
          type: "heating",
          properties: {
            setTemperature: { writableMin: 10, writableMax: 30, step: 1 },
          },
        },
      ],
    },
  });
  assert.deepEqual(store.temperatureRange("heating"), { minValue: 10, maxValue: 30, minStep: 1 });
  await assert.rejects(
    store.write("heating", "test", [{ command: "setTemperature", value: "31" }]),
    /outside/,
  );
  assert.equal(writes, 0);
});

test("status readers ignore ordering, retain additional fields and reject missing/invalid values", () => {
  const d = {
    statusList: [
      { command: "operationTime", value: "0" },
      { command: "flowValveOpenClose", value: "open" },
      { command: "currTemperature", value: "22.5" },
      { command: "power", value: "on" },
    ],
  };
  assert.equal(statusOn(d), true);
  assert.equal(statusNumber(d, "currTemperature"), 22.5);
  assert.equal(statusValue(d, "flowValveOpenClose"), "open");
  assert.throws(() => statusOn({ statusList: [] }), /Missing/);
  assert.throws(
    () => statusOn({ statusList: [{ command: "power", value: "unknown" }] }),
    /Invalid/,
  );
  assert.throws(
    () => statusNumber({ statusList: [{ command: "currentWatt", value: "" }] }, "currentWatt"),
    /Invalid/,
  );
});
