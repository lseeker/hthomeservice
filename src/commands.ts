import type { HTStatus, HTWritableDeviceType } from "./types.js";
import { devices, type CommandRule, type DeviceDefinition } from "./devices.js";
import { HTValidationError } from "./validation.js";

function allowedValue(rule: CommandRule, value: string): boolean {
  if ("min" in rule) {
    const temperature = Number(value);
    return (
      Boolean(value.trim()) &&
      Number.isInteger(temperature) &&
      temperature >= rule.min &&
      temperature <= rule.max
    );
  }
  return rule.includes(value);
}

export function validateCommands(type: HTWritableDeviceType, commands: readonly HTStatus[]) {
  if (!commands.length) {
    throw new HTValidationError("At least one command is required");
  }
  const definition: DeviceDefinition | undefined = Object.hasOwn(devices, type)
    ? devices[type]
    : undefined;
  for (const { command, value } of commands) {
    const rule =
      definition && Object.hasOwn(definition.commands, command)
        ? definition.commands[command]
        : undefined;
    if (!rule || !allowedValue(rule, value)) {
      throw new HTValidationError(`Unsupported ${type} command or value: ${command}`);
    }
  }
}
