import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { URL } from "node:url";
import { Cookie } from "tough-cookie";
import {
  HTWebService,
  HTDeviceStore,
  statusValue,
  statusNumber,
  statusOn,
  statusDetected,
} from "@yylee/hthomeservice";
import {
  observedList,
  observedState,
  observedProperties,
  observedStates,
} from "./fixtures/observed-devices.mjs";

const logger = { debug() {}, info() {}, warn() {} };

async function fixture(t, override = () => false, options = {}) {
  const requests = [];
  const sessionExpirations = [];
  const loggedExpirations = [];
  let logins = 0;
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
      }
      const entry = {
        method: request.method,
        path: request.url,
        cookie: request.headers.cookie,
        body: body ? JSON.parse(body) : undefined,
      };
      requests.push(entry);
      response.setHeader("Content-Type", "application/json");
      if (await override(entry, response)) {
        return;
      }
      if (entry.path === "/login") {
        logins++;
        await setTimeout(10);
        const expires = new Date(Date.now() + 3600000).toUTCString();
        sessionExpirations.push(new Date(expires));
        response.setHeader(
          "Set-Cookie",
          `connect.sid=session-${logins}; Path=/; Expires=${expires}; HttpOnly; SameSite=Strict`,
        );
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("OK");
      } else if (entry.path === "/proxy/bearer/api/v1/user/danji/household") {
        response.end(
          JSON.stringify({
            resultCode: 100,
            resultData: {
              danjiList: [{ siteId: "test-site", dong: "101", ho: "1001", isApproved: true }],
            },
          }),
        );
      } else if (entry.path === "/getctoctoken") {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader(
          "Set-Cookie",
          `connect.sid=session-${logins}; Path=/; Expires=${sessionExpirations.at(-1).toUTCString()}; HttpOnly; SameSite=Strict`,
        );
        response.end("OK");
      } else {
        const url = new URL(entry.path, "http://test.invalid");
        const parts = url.pathname.split("/");
        const types = {
          lights: "light",
          fans: "fan",
          heaters: "heating",
          aircons: "aircon",
          "wall-sockets": "wallsocket",
          switches: "multi_switch",
          gases: "gas",
        };
        if (url.pathname.endsWith("/properties")) {
          response.end(JSON.stringify(observedProperties()));
        } else if (parts.at(-1) === "devices") {
          response.end(
            JSON.stringify(
              observedList(
                url.searchParams.get("deviceType"),
                url.searchParams.get("includeStatus") === "true",
              ),
            ),
          );
        } else if (entry.method === "GET" && types[parts.at(-2)]) {
          response.end(
            JSON.stringify(observedState(types[parts.at(-2)], decodeURIComponent(parts.at(-1)))),
          );
        } else {
          response.end(
            JSON.stringify({
              resultStatus: "success",
              data: {
                id: decodeURIComponent(parts.at(-1)),
                deviceType: types[parts.at(-2)],
                deviceDetailName: "test",
                state: "NORMAL",
                statusList: entry.body?.commandList ?? [{ command: "power", value: "off" }],
              },
            }),
          );
        }
      }
    })().catch((error) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: error.message }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const fixtureLogger = {
    ...logger,
    info(message, ...parameters) {
      if (message === "HTWS: Session expire at") {
        loggedExpirations.push(parameters[0]);
      }
    },
  };
  const client = new HTWebService("test-user", "test-password", fixtureLogger, {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    ...options,
  });
  t.after(async () => {
    client.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { client, requests, sessionExpirations, loggedExpirations };
}

for (const { name, approvals, selected } of [
  { name: "first approved household", approvals: [false, true, true], selected: 1 },
  {
    name: "approved household takes priority over missing approval",
    approvals: [undefined, true],
    selected: 1,
  },
  {
    name: "first household when approval information is absent",
    approvals: [undefined, undefined],
    selected: 0,
  },
  { name: "first household when none are approved", approvals: [false, false], selected: 0 },
  {
    name: "first household when approval is missing or false",
    approvals: [undefined, false],
    selected: 0,
  },
  { name: "empty household list", approvals: [], selected: null },
]) {
  test(`household selection: ${name}`, async (t) => {
    const { client, requests } = await fixture(t, (request, response) => {
      if (request.path !== "/proxy/bearer/api/v1/user/danji/household") {
        return false;
      }
      response.end(
        JSON.stringify({
          resultCode: "100",
          resultData: {
            danjiList: approvals.map((isApproved, index) => ({
              siteId: `site-${index}`,
              dong: `dong-${index}`,
              ho: `ho-${index}`,
              isApproved,
            })),
          },
        }),
      );
      return true;
    });
    if (selected === null) {
      await assert.rejects(client.getDevices(), /Authentication failed/);
      assert.equal(
        requests.some((request) => request.path === "/getctoctoken"),
        false,
      );
      assert.equal(
        requests.some((request) => request.path.startsWith("/proxy/ctoc/")),
        false,
      );
    } else {
      await client.getDevices();
      assert.deepEqual(requests.find((request) => request.path === "/getctoctoken").body, {
        siteId: `site-${selected}`,
        dong: `dong-${selected}`,
        ho: `ho-${selected}`,
        clientId: "HT-WEB",
        uuid: "",
      });
    }
  });
}

test("invalid household responses stop authentication before token or device requests", async (t) => {
  for (const payload of [
    { resultCode: "500", resultData: { danjiList: [{ siteId: "site", dong: "101", ho: "1001" }] } },
    { resultCode: "100", resultData: null },
    { resultCode: "100", resultData: { danjiList: [{ siteId: "site", dong: 101, ho: "1001" }] } },
  ]) {
    await t.test(JSON.stringify(payload), async (t) => {
      const { client, requests } = await fixture(t, (request, response) => {
        if (!request.path.endsWith("/household")) return false;
        response.end(JSON.stringify(payload));
        return true;
      });
      await assert.rejects(client.getDevices(), /Authentication failed/);
      await assert.rejects(client.getDevices(), /temporarily paused/);
      assert.equal(requests.filter((request) => request.path === "/login").length, 1);
      assert.equal(
        requests.some(
          (request) => request.path === "/getctoctoken" || request.path.startsWith("/proxy/ctoc/"),
        ),
        false,
      );
    });
  }
});

test("observed device lists omit status by default and include raw states when requested", async (t) => {
  const { client } = await fixture(t);
  const devices = await client.getDevices();
  assert.equal(devices.data.deviceList.length, 7);
  assert.equal(devices.data.totalCount, 9);
  assert.ok(devices.data.deviceList.every((device) => device.statusList.length === 0));
  for (const [type, expected] of Object.entries(observedStates)) {
    if (["elevator", "eventsender"].includes(type)) continue;
    const response = await client.getDevices({ deviceType: type, includeStatus: true });
    assert.equal(response.data.totalCount, 1);
    assert.equal(response.data.deviceList[0].state, expected.state);
    assert.deepEqual(response.data.deviceList[0].statusList, expected.statusList);
    const individual = await client.getDeviceState(type, `${type}-test`);
    assert.equal(individual.data.state, expected.state);
    assert.deepEqual(
      individual.data.statusList,
      type === "fan"
        ? expected.statusList.filter((status) => ["power", "wind"].includes(status.command))
        : expected.statusList,
    );
  }
});

test("observed metadata and wire status names stay distinct through the HTTP client and store", async (t) => {
  const { client } = await fixture(t);
  const properties = await client.getDeviceProperties();
  assert.equal(
    properties.data.deviceList.some((entry) => entry.type === "curtain"),
    false,
  );
  const store = new HTDeviceStore(client);
  store.setProperties(properties);
  assert.deepEqual(store.temperatureRange("heating"), { minValue: 5, maxValue: 40, minStep: 1 });
  assert.deepEqual(store.temperatureRange("aircon"), { minValue: 5, maxValue: 40, minStep: 1 });
  const heating = await store.read("heating", "heating-test");
  assert.equal(statusNumber(heating, "currTemperature"), 23);
  assert.equal(statusValue(heating, "flowValveOpenClose"), "close");
  assert.throws(() => statusNumber(heating, "currentTemperature"), /Missing/);
  const fan = await store.read("fan", "fan-test");
  assert.equal(statusValue(fan, "wind"), "light");
  assert.equal(statusValue(fan, "offReservation"), "false");
  assert.equal(statusNumber(fan, "operationTime"), 0);
  assert.throws(() => statusValue(fan, "level"), /Missing/);
  const socket = await store.read("wallsocket", "wallsocket-test");
  assert.equal(statusOn(socket, "sleep"), true);
  assert.equal(statusNumber(socket, "currentWatt"), 0);
  assert.equal(statusNumber(socket, "blockWatt"), 0);
  assert.throws(() => statusOn(socket, "sleepMode"), /Missing/);
  const gas = await store.read("gas", "gas-test");
  assert.equal(statusDetected(gas, "gas"), false);
  assert.equal(statusDetected(gas, "fire"), false);
});

test("observed UNKNOWN aircon values remain readable but store never sends controls", async (t) => {
  const { client, requests } = await fixture(t);
  const store = new HTDeviceStore(client);
  const aircon = await store.read("aircon", "aircon-test");
  assert.equal(aircon.state, "UNKNOWN");
  assert.equal(statusOn(aircon), false);
  assert.equal(statusValue(aircon, "mode"), "airwash");
  assert.equal(statusValue(aircon, "wind"), "pow");
  assert.equal(statusNumber(aircon, "setTemperature"), 26);
  assert.equal(statusNumber(aircon, "currTemperature"), 27);
  await assert.rejects(
    store.write("aircon", "aircon-test", [{ command: "power", value: "on" }]),
    /NORMAL/,
  );
  assert.equal(
    requests.some((request) => request.method === "PUT"),
    false,
  );
});

test("observed 409 login failure stops authentication and is not retried", async (t) => {
  const { client, requests } = await fixture(t, (request, response) => {
    if (request.path !== "/login") return false;
    response.statusCode = 409;
    response.end(
      JSON.stringify({
        errorCode: 104,
        errorMessage: "Invalid credentials",
        resultData: { loginFailCount: 1 },
      }),
    );
    return true;
  });
  await assert.rejects(client.getDevices(), /Authentication failed/);
  await assert.rejects(client.getDevices(), /temporarily paused/);
  assert.equal(requests.length, 1);
});

test("token business failure is rejected before device queries", async (t) => {
  const { client, requests } = await fixture(t, (request, response) => {
    if (request.path !== "/getctoctoken") return false;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("FAIL");
    return true;
  });
  await assert.rejects(client.getDevices(), /Authentication failed/);
  assert.equal(
    requests.some((request) => request.path.startsWith("/proxy/ctoc/")),
    false,
  );
});

test("observed Expires cookie represents the exact UTC expiration instant", () => {
  const cookie = Cookie.parse(
    "connect.sid=s%3Atest-session.test-signature; Path=/; Expires=Sun, 01 Nov 2026 14:42:01 GMT; HttpOnly; SameSite=Strict",
  );
  assert.ok(cookie);
  assert.equal(cookie.expiryTime(), Date.parse("2026-11-01T14:42:01.000Z"));
  assert.equal(cookie.expires.toISOString(), "2026-11-01T14:42:01.000Z");
  assert.equal(cookie.maxAge, null);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "strict");
});

test("Expires is used for session lifetime and reauthentication precedes control after expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { client, requests, sessionExpirations, loggedExpirations } = await fixture(t);
  await client.getDevices();
  assert.deepEqual(loggedExpirations, sessionExpirations);
  assert.equal(loggedExpirations.length, 1);
  t.mock.timers.tick(3600001);
  await client.putLightPower("light-1", true);
  assert.equal(requests.filter((r) => r.path === "/login").length, 2);
  assert.equal(requests.at(-1).method, "PUT");
  assert.equal(requests.at(-1).cookie, "connect.sid=session-2");
  assert.deepEqual(loggedExpirations, sessionExpirations);
});

test("concurrent device reads share login and pass the new cookie to every first request", async (t) => {
  const { client, requests } = await fixture(t);
  await Promise.all([
    client.getDevices(),
    client.getLightState("light-1"),
    client.getFanState("fan-1"),
  ]);
  assert.equal(requests.filter((r) => r.path === "/login").length, 1);
  const login = requests.find((r) => r.path === "/login").body;
  assert.match(login.id, /^U2FsdGVkX1/);
  assert.match(login.password, /^U2FsdGVkX1/);
  assert.equal(login.rememberMe, false);
  assert.deepEqual(requests.find((r) => r.path === "/getctoctoken").body, {
    siteId: "test-site",
    dong: "101",
    ho: "1001",
    clientId: "HT-WEB",
    uuid: "",
  });
  for (const r of requests.filter((r) => r.path.startsWith("/proxy/ctoc/"))) {
    assert.equal(r.cookie, "connect.sid=session-1");
  }
});

test("expired server session reauthenticates and retries the device request with the new cookie", async (t) => {
  const { client, requests } = await fixture(t, (r, response) => {
    if (r.path === "/proxy/ctoc/devices" && r.cookie === "connect.sid=session-1") {
      response.statusCode = 401;
      response.end("{}");
      return true;
    }
    return false;
  });
  await client.getDevices();
  assert.equal(requests.filter((r) => r.path === "/login").length, 2);
  assert.equal(requests.at(-1).cookie, "connect.sid=session-2");
});

test(
  "401 during household authentication fails without waiting for its own authentication task",
  { timeout: 2000 },
  async (t) => {
    const { client, requests } = await fixture(t, (r, response) => {
      if (r.path.includes("/household")) {
        response.statusCode = 401;
        response.end("{}");
        return true;
      }
      return false;
    });
    await assert.rejects(client.getDevices(), /Authentication failed/);
    await assert.rejects(client.getDevices(), /temporarily paused/);
    assert.equal(requests.filter((r) => r.path === "/login").length, 1);
    assert.equal(
      requests.some((r) => r.path.startsWith("/proxy/ctoc/")),
      false,
    );
  },
);

test("missing session cookie fails once rather than repeatedly logging in", async (t) => {
  const { client, requests } = await fixture(t, (r, response) => {
    if (r.path === "/login") {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("OK");
      return true;
    }
    return false;
  });
  await assert.rejects(client.getDevices(), /Authentication failed/);
  assert.equal(requests.filter((r) => r.path === "/login").length, 1);
  assert.equal(
    requests.some((r) => r.path.includes("/household") || r.path === "/getctoctoken"),
    false,
  );
});

test("login rejects unexpected success bodies and invalid issued cookies before household requests", async (t) => {
  for (const scenario of [
    { body: "{}", cookie: "connect.sid=test; Path=/" },
    { body: "FAIL", cookie: "connect.sid=test; Path=/" },
    { body: "OK", cookie: "other=test; Path=/" },
    { body: "OK", cookie: "connect.sid=; Path=/" },
    { body: "OK", cookie: "connect.sid=test; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" },
    { body: "OK", cookie: "connect.sid=test; Path=/other" },
    { body: "OK", cookie: "connect.sid=test; Path=/", status: 201 },
  ]) {
    await t.test(JSON.stringify(scenario), async (t) => {
      const { client, requests } = await fixture(t, (r, response) => {
        if (r.path !== "/login") return false;
        response.statusCode = scenario.status ?? 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Set-Cookie", scenario.cookie);
        response.end(scenario.body);
        return true;
      });
      await assert.rejects(client.getDevices(), /Authentication failed/);
      await assert.rejects(client.getDevices(), /temporarily paused/);
      assert.equal(requests.length, 1);
    });
  }
});

test("device routes and control payloads remain compatible", async (t) => {
  const { client, requests } = await fixture(t);
  await client.putLightPower("light-1", true);
  await client.putFanPower("fan-1", false);
  await client.putFanWind("fan-1", "mid");
  await client.getHeaterState("heater-1");
  assert.deepEqual(
    requests
      .filter((r) => r.path.startsWith("/proxy/ctoc/"))
      .map(({ method, path, body }) => ({
        method,
        path,
        body,
      })),
    [
      {
        method: "PUT",
        path: "/proxy/ctoc/lights/light-1",
        body: { commandList: [{ command: "power", value: "on" }] },
      },
      {
        method: "PUT",
        path: "/proxy/ctoc/fans/fan-1",
        body: { commandList: [{ command: "power", value: "off" }] },
      },
      {
        method: "PUT",
        path: "/proxy/ctoc/fans/fan-1",
        body: { commandList: [{ command: "wind", value: "mid" }] },
      },
      { method: "GET", path: "/proxy/ctoc/heaters/heater-1", body: undefined },
    ],
  );
});

test("close cancels an in-flight read and prevents later network requests", async (t) => {
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const { client, requests } = await fixture(t, (r) => {
    if (r.path === "/proxy/ctoc/devices") {
      started();
      return true;
    }
    return false;
  });
  const read = assert.rejects(client.getDevices());
  await pending;
  client.close();
  await read;
  const count = requests.length;
  await assert.rejects(client.getDevices());
  assert.equal(requests.length, count);
});

test("an unresponsive login times out without leaking credentials in its error", async (t) => {
  const { client } = await fixture(t, (r) => r.path === "/login", { requestTimeoutMs: 50 });
  await assert.rejects(client.getDevices(), (error) => {
    assert.match(error.message, /Authentication failed/);
    // got wraps hook failures; the inner authentication error must discard the login request.
    assert.match(error.cause.message, /Authentication failed/);
    assert.equal(error.cause.cause, undefined);
    assert.equal(error.message.includes("test-password"), false);
    return true;
  });
});

test("batch queries encode the observed deviceType/includeStatus options and read properties", async (t) => {
  const { client, requests } = await fixture(t);
  await client.getDevices({ deviceType: "wallsocket", includeStatus: true });
  await client.getDeviceProperties();
  assert.equal(
    requests.at(-2).path,
    "/proxy/ctoc/devices?deviceType=wallsocket&includeStatus=true",
  );
  assert.equal(requests.at(-1).path, "/proxy/ctoc/devices/properties");
  const count = requests.length;
  await assert.rejects(client.getDevices({ includeStatus: true }), /requires a deviceType/);
  assert.equal(requests.length, count);
});

test("new device commands use confirmed web routes, raw field names and one command per PUT", async (t) => {
  const { client, requests } = await fixture(t);
  await client.putHeaterPower("h", true);
  await client.putHeaterTemperature("h", 23);
  await client.putAirconTemperature("a", 25);
  await client.putAirconMode("a", "cool");
  await client.putAirconWind("a", "pow");
  await client.putWallSocketPower("socket/1", false);
  await client.putMultiSwitchLightsOut("s", true);
  await client.putMultiSwitchLightsOut("s", false);
  await client.putGasClose("gas/1");
  assert.deepEqual(
    requests.filter((r) => r.method === "PUT").map((r) => [r.path, r.body.commandList]),
    [
      ["/proxy/ctoc/heaters/h", [{ command: "power", value: "on" }]],
      ["/proxy/ctoc/heaters/h", [{ command: "setTemperature", value: "23" }]],
      ["/proxy/ctoc/aircons/a", [{ command: "setTemperature", value: "25" }]],
      ["/proxy/ctoc/aircons/a", [{ command: "mode", value: "cool" }]],
      ["/proxy/ctoc/aircons/a", [{ command: "wind", value: "pow" }]],
      ["/proxy/ctoc/wall-sockets/socket%2F1", [{ command: "power", value: "off" }]],
      ["/proxy/ctoc/switches/s", [{ command: "power", value: "on" }]],
      ["/proxy/ctoc/switches/s", [{ command: "power", value: "off" }]],
      ["/proxy/ctoc/gases/gas%2F1", [{ command: "power", value: "off" }]],
    ],
  );
});

test("unverified and dangerous commands and invalid temperatures are rejected before authentication", async (t) => {
  const { client, requests } = await fixture(t);
  for (const [type, command, value] of [
    ["gas", "power", "on"],
    ["elevator", "call", "on"],
    ["eventsender", "power", "on"],
    ["fan", "wind", "auto"],
    ["fan", "wind", "stop"],
    ["wallsocket", "sleepMode", "on"],
    ["multi_switch", "gas", "off"],
    ["aircon", "mode", "cooling"],
    ["aircon", "wind", "strong"],
    ["heating", "setTemperature", "NaN"],
    ["heating", "setTemperature", "4"],
    ["heating", "setTemperature", "41"],
    ["heating", "setTemperature", "22.5"],
  ]) {
    await assert.rejects(
      client.putDeviceCommands(type, "test", [{ command, value }]),
      /Unsupported/,
    );
  }
  assert.equal(requests.length, 0);
});

test("writes are not automatically replayed after a server failure and command sequences stop on error", async (t) => {
  const { client, requests } = await fixture(t, (r, response) => {
    if (r.method === "PUT") {
      response.statusCode = 503;
      response.end("{}");
      return true;
    }
    return false;
  });
  await assert.rejects(
    client.putDeviceCommands("aircon", "test", [
      { command: "mode", value: "cool" },
      { command: "power", value: "on" },
    ]),
  );
  assert.equal(requests.filter((r) => r.method === "PUT").length, 1);
});

test("HTTP success cannot hide a business error, malformed status or mismatched device identity", async (t) => {
  let payload;
  const { client } = await fixture(t, (r, response) => {
    if (r.path === "/proxy/ctoc/lights/test") {
      response.end(JSON.stringify(payload));
      return true;
    }
    return false;
  });
  payload = { resultStatus: "failure", data: {} };
  await assert.rejects(client.getLightState("test"), /did not report success/);
  payload = {
    resultStatus: "success",
    data: {
      id: "different",
      deviceType: "light",
      deviceDetailName: "test",
      state: "NORMAL",
      statusList: [],
    },
  };
  await assert.rejects(client.getLightState("test"), /identity does not match/);
  payload.data.id = "test";
  payload.data.statusList = [{ command: "power", value: true }];
  await assert.rejects(client.getLightState("test"), /Invalid HT status list/);
});

test("unsupported elevator and event sender are filtered and cannot query individual endpoints", async (t) => {
  const { client, requests } = await fixture(t);
  const response = await client.getDevices();
  assert.equal(response.data.totalCount, 9);
  assert.ok(
    response.data.deviceList.every(
      (device) => !["elevator", "eventsender"].includes(device.deviceType),
    ),
  );
  const count = requests.length;
  for (const type of ["elevator", "eventsender"]) {
    await assert.rejects(client.getDeviceState(type, "passive"), /Unsupported HT device type/);
  }
  assert.equal(requests.length, count);
});
