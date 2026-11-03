/** Internal protocol definitions; numeric validation is implemented in commands.ts. */
export type CommandRule = readonly string[] | { readonly min: number; readonly max: number };
export interface DeviceDefinition {
  readonly path: string;
  readonly commands: Readonly<Record<string, CommandRule>>;
}

const power = ["on", "off"] as const;
const wind = ["light", "mid", "pow"] as const;
const temperature = { min: 5, max: 40 } as const;

export const devices = {
  heating: { path: "heaters", commands: { power, setTemperature: temperature } },
  light: { path: "lights", commands: { power } },
  gas: { path: "gases", commands: { power: ["off"] } },
  aircon: {
    path: "aircons",
    commands: {
      power,
      mode: ["auto", "cool", "dehumidify", "airwash"],
      wind,
      setTemperature: temperature,
    },
  },
  wallsocket: { path: "wall-sockets", commands: { power } },
  multi_switch: { path: "switches", commands: { power } },
  fan: { path: "fans", commands: { power, wind } },
} as const satisfies Record<string, DeviceDefinition>;
