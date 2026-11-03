/** Minimal logger accepted by any bridge adapter. Homebridge Logging satisfies this contract. */
export interface HTLogger {
  debug(message: string, ...parameters: unknown[]): void;
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
}
