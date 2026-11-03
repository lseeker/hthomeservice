import got, { type Got, type NormalizedOptions } from "got";
import { Cookie, CookieJar } from "tough-cookie";
import { encryptAES } from "./credentials.js";
import type { HTLogger } from "./logger.js";
import type { HTDeviceApi } from "./device-api.js";
import type {
  HTDeviceType,
  HTDeviceQuery,
  HTWritableDeviceType,
  HTStatus,
  HTAirconMode,
  HTWind,
  HTDeviceStateResponse,
} from "./types.js";
import { validateCommands } from "./commands.js";
import { devices } from "./devices.js";
import {
  devicesResponse,
  stateResponse,
  propertiesResponse,
  HTValidationError,
  householdResponse,
} from "./validation.js";

const HTSECRET = "hTsEcret";
const HTURL = "https://www2.hthomeservice.com";

export interface HTWebServiceOptions {
  /** Override for a local test server or a compatible HT web service. */
  baseUrl?: string;
  requestTimeoutMs?: number;
}

/** Authenticated HT web protocol client. */
export class HTWebService implements HTDeviceApi {
  private readonly username: string;
  private readonly password: string;
  private readonly cookieJar = new CookieJar();
  private readonly client: Got;
  private readonly baseUrl: string;
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private readonly abortController = new AbortController();
  private expire: Date | null = null;
  private authentication: Promise<void> | null = null;
  private nextAuthAttemptAt = 0;

  constructor(
    username: string,
    password: string,
    private readonly log: HTLogger,
    options: HTWebServiceOptions = {},
  ) {
    this.username = encryptAES(username, HTSECRET);
    this.password = encryptAES(password, HTSECRET);
    this.baseUrl = options.baseUrl ?? HTURL;
    this.client = got.extend({
      prefixUrl: this.baseUrl,
      cookieJar: this.cookieJar,
      signal: this.abortController.signal,
      timeout: { request: options.requestTimeoutMs ?? 10000 },
      retry: {
        statusCodes: [401, 408, 429, 502, 503, 504],
      },
      hooks: {
        beforeRequest: [
          async (options) => {
            if (!options.context.onAuthenticate) {
              await this.ensureAuthenticated(options);
            }
          },
        ],
        beforeRetry: [
          async (error) => {
            // Authentication calls must never wait for their own authentication task.
            if (error.response?.statusCode === 401 && !error.options.context.onAuthenticate) {
              this.expire = null;
              await this.ensureAuthenticated(error.options);
            }
          },
        ],
        beforeError: [
          (error) => {
            if (error.response?.statusCode === 401) {
              this.expire = null;
            }
            return error;
          },
        ],
      },
    });

    this.refreshTimer = setInterval(() => {
      if (this.expire !== null && this.isExpired()) {
        void this.ensureAuthenticated().catch(() => {
          this.log.warn("HTWS: Background authentication failed; waiting for the next request");
        });
      }
    }, 30000);
    this.refreshTimer.unref();
  }

  /** Stop background renewal and cancel in-flight requests. */
  public close() {
    clearInterval(this.refreshTimer);
    this.abortController.abort();
  }

  private async postLogin() {
    this.log.debug("HTWS: post login");
    const response = await this.client.post("login", {
      json: { id: this.username, password: this.password, rememberMe: false },
      context: { onAuthenticate: true },
      retry: { limit: 0 },
    });
    if (response.statusCode !== 200 || response.body !== "OK") {
      throw new HTValidationError("HT login did not report success");
    }
    const issuedSession = response.headers["set-cookie"]?.some((header) => {
      const cookie = Cookie.parse(header);
      return cookie?.key === "connect.sid" && Boolean(cookie.value);
    });
    const session = this.sessionCookie();
    if (!issuedSession || !session?.value) {
      throw new HTValidationError("HT login did not provide a valid session cookie");
    }
  }

  private async postCtocToken() {
    this.log.debug("HTWS: get household");
    const household = householdResponse(
      await this.client
        .get("proxy/bearer/api/v1/user/danji/household", {
          context: { onAuthenticate: true },
          retry: { limit: 0 },
        })
        .json<unknown>(),
    );
    const households = household.resultData.danjiList;
    const danji = households.find((entry) => entry.isApproved === true) ?? households[0];
    if (!danji) {
      throw new Error("No eligible household found for the user");
    }
    const response = await this.client.post("getctoctoken", {
      json: { siteId: danji.siteId, dong: danji.dong, ho: danji.ho, clientId: "HT-WEB", uuid: "" },
      context: { onAuthenticate: true },
      retry: { limit: 0 },
    });
    if (response.statusCode !== 200 || response.body !== "OK") {
      throw new HTValidationError("HT token request did not report success");
    }
    const session = this.sessionCookie();
    if (!session) {
      throw new Error("HT web service did not provide a session cookie");
    }
    this.expire =
      session.expires === "Infinity" ? new Date("9999-12-31T23:59:59Z") : session.expires;
    if (this.isExpired()) {
      throw new Error("HT web service provided an expired session cookie");
    }
    this.log.info("HTWS: Session expire at", this.expire);
  }

  private sessionCookie() {
    return this.cookieJar
      .getCookiesSync(this.baseUrl)
      .find((cookie) => cookie.key === "connect.sid");
  }

  private isExpired() {
    return this.expire === null || this.expire.getTime() <= Date.now();
  }

  private async authenticate() {
    try {
      this.log.info("HTWS: Re-authenticating");
      await this.postLogin();
      await this.postCtocToken();
    } catch {
      this.expire = null;
      this.nextAuthAttemptAt = Date.now() + 30000;
      // Request errors can contain encrypted credentials and cookies; do not propagate those options.
      throw new Error(
        "HTWS: Authentication failed; check account access and service availability. Retry after 30 seconds.",
      );
    }
  }

  private async ensureAuthenticated(options?: Pick<NormalizedOptions, "headers">) {
    if (this.abortController.signal.aborted) {
      throw new Error("HTWS: Client is closed");
    }
    if (this.isExpired()) {
      if (this.authentication === null) {
        if (Date.now() < this.nextAuthAttemptAt) {
          throw new Error("HTWS: Authentication is temporarily paused after a failed attempt");
        }
        this.authentication = this.authenticate().finally(() => {
          this.authentication = null;
        });
      }
      await this.authentication;
    }
    if (options) {
      // got can prepare cookies before the login performed inside this hook.
      options.headers.cookie = this.cookieJar.getCookieStringSync(this.baseUrl);
    }
  }

  public async getDevices(query: HTDeviceQuery = {}) {
    if (query.includeStatus && !query.deviceType) {
      throw new HTValidationError("includeStatus requires a deviceType");
    }
    const searchParams: Record<string, string> = {};
    if (query.deviceType) {
      searchParams.deviceType = query.deviceType;
    }
    if (query.includeStatus !== undefined) {
      searchParams.includeStatus = String(query.includeStatus);
    }
    return devicesResponse(
      await this.client.get("proxy/ctoc/devices", { searchParams }).json<unknown>(),
    );
  }

  public async getDeviceProperties() {
    return propertiesResponse(
      await this.client.get("proxy/ctoc/devices/properties").json<unknown>(),
    );
  }

  public async getDeviceState<T extends HTDeviceType>(
    type: T,
    id: string,
  ): Promise<HTDeviceStateResponse<T>> {
    if (!id) {
      throw new HTValidationError("A device id is required");
    }
    if (!Object.hasOwn(devices, type)) {
      throw new HTValidationError("Unsupported HT device type");
    }
    const path = devices[type].path;
    return stateResponse(
      await this.client.get(`proxy/ctoc/${path}/${encodeURIComponent(id)}`).json<unknown>(),
      type,
      id,
    );
  }

  public async putDeviceCommands<T extends HTWritableDeviceType>(
    type: T,
    id: string,
    commands: readonly HTStatus[],
  ) {
    validateCommands(type, commands);
    if (!id) {
      throw new HTValidationError("A device id is required");
    }
    let response: HTDeviceStateResponse<T> | undefined;
    // The web UI sends one command per request. Do not assume atomic multi-command execution.
    for (const command of commands) {
      response = stateResponse(
        await this.client
          .put(`proxy/ctoc/${devices[type].path}/${encodeURIComponent(id)}`, {
            json: { commandList: [command] },
            retry: { limit: 0 },
          })
          .json<unknown>(),
        type,
        id,
      );
    }
    return response!;
  }

  public getLightState(id: string) {
    return this.getDeviceState("light", id);
  }
  public putLightPower(id: string, power: boolean) {
    return this.putDeviceCommands("light", id, [this.power(power)]);
  }
  public getFanState(id: string) {
    return this.getDeviceState("fan", id);
  }
  public putFanPower(id: string, power: boolean) {
    return this.putDeviceCommands("fan", id, [this.power(power)]);
  }
  public putFanWind(id: string, wind: HTWind) {
    return this.putDeviceCommands("fan", id, [{ command: "wind", value: wind }]);
  }
  public getHeaterState(id: string) {
    return this.getDeviceState("heating", id);
  }
  public putHeaterPower(id: string, power: boolean) {
    return this.putDeviceCommands("heating", id, [this.power(power)]);
  }
  public putHeaterTemperature(id: string, temperature: number) {
    return this.putDeviceCommands("heating", id, [
      { command: "setTemperature", value: String(temperature) },
    ]);
  }

  public getAirconState(id: string) {
    return this.getDeviceState("aircon", id);
  }
  public putAirconPower(id: string, power: boolean) {
    return this.putDeviceCommands("aircon", id, [this.power(power)]);
  }
  public putAirconTemperature(id: string, temperature: number) {
    return this.putDeviceCommands("aircon", id, [
      { command: "setTemperature", value: String(temperature) },
    ]);
  }

  public putAirconMode(id: string, mode: HTAirconMode) {
    return this.putDeviceCommands("aircon", id, [{ command: "mode", value: mode }]);
  }

  public putAirconWind(id: string, wind: HTWind) {
    return this.putDeviceCommands("aircon", id, [{ command: "wind", value: wind }]);
  }
  public getWallSocketState(id: string) {
    return this.getDeviceState("wallsocket", id);
  }
  public putWallSocketPower(id: string, power: boolean) {
    return this.putDeviceCommands("wallsocket", id, [this.power(power)]);
  }
  public getMultiSwitchState(id: string) {
    return this.getDeviceState("multi_switch", id);
  }
  /** Activate lights-out; false restores the previous lighting state. */
  public putMultiSwitchLightsOut(id: string, lightsOut: boolean) {
    return this.putDeviceCommands("multi_switch", id, [this.power(lightsOut)]);
  }

  public getGasState(id: string) {
    return this.getDeviceState("gas", id);
  }
  /** Close only; reopening requires local operation. */
  public putGasClose(id: string) {
    return this.putDeviceCommands("gas", id, [this.power(false)]);
  }
  private power(value: boolean): HTStatus {
    return { command: "power", value: value ? "on" : "off" };
  }
}
