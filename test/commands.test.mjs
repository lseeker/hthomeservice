import assert from "node:assert/strict";
import test from "node:test";
import { validateCommands } from "../dist/commands.js";
import { HTValidationError } from "@yylee/hthomeservice";

test("observed light, heater and socket power commands remain valid", () => {
  for (const type of ["light", "heating", "wallsocket"]) {
    for (const value of ["on", "off"]) {
      assert.doesNotThrow(() => validateCommands(type, [{ command: "power", value }]));
    }
  }
});

test("temperature validation retains integer bounds and remains limited to heating and aircon", () => {
  for (const type of ["heating", "aircon"]) {
    for (const value of ["5", "23", "40"]) {
      assert.doesNotThrow(() => validateCommands(type, [{ command: "setTemperature", value }]));
    }
    for (const value of ["", " ", "4", "41", "22.5", "NaN", "Infinity"]) {
      assert.throws(
        () => validateCommands(type, [{ command: "setTemperature", value }]),
        HTValidationError,
      );
    }
  }
  assert.throws(
    () => validateCommands("fan", [{ command: "setTemperature", value: "23" }]),
    HTValidationError,
  );
});

test("read-only devices and unverified commands are rejected", () => {
  for (const [type, command, value] of [
    ["gas", "power", "on"],
    ["elevator", "call", "on"],
    ["eventsender", "power", "on"],
    ["fan", "wind", "strong"],
    ["aircon", "mode", "cooling"],
    ["multi_switch", "gas", "off"],
    ["wallsocket", "sleepMode", "on"],
    ["light", "constructor", "on"],
    ["constructor", "power", "on"],
  ]) {
    assert.throws(() => validateCommands(type, [{ command, value }]), HTValidationError);
  }
  assert.throws(() => validateCommands("light", []), HTValidationError);
});

test("gas accepts only the close command from the web control code", () => {
  assert.doesNotThrow(() => validateCommands("gas", [{ command: "power", value: "off" }]));
  for (const value of ["on", "open", "close", "false"]) {
    assert.throws(() => validateCommands("gas", [{ command: "power", value }]), HTValidationError);
  }
});
