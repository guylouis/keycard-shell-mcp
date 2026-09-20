/**
 * Device layer: open the Shell, run one command, close.
 *
 * The transport is opened per operation rather than held. A signing session is minutes
 * of idle time waiting for a human, and a stale HID handle across a sleep/wake cycle is
 * a worse failure than one extra open() per call.
 */

import { ShellJS } from "@choppu/shelljs";
import { ShellJSNodeHID } from "@choppu/shelljs-node-hid";
import { explain, type Operation } from "./errors.js";

export type Commands = InstanceType<typeof ShellJS.Commands>;

export interface DeviceInfo {
  fwVersion: string;
  dbVersion: number;
  serialNumber: string;
  publicKey: string;
}

/**
 * Open the Shell, hand the caller a command set, and always close afterwards.
 *
 * @param op  What is being attempted, so a rejection can name the likely cause instead of
 *            listing every cause the device has.
 */
export async function withShell<T>(fn: (cmd: Commands) => Promise<T>, op?: Operation): Promise<T> {
  let transport: { close(): Promise<void> } | undefined;

  try {
    transport = await ShellJSNodeHID.TransportNodeHid.default.open();
    const cmd = new ShellJS.Commands(transport as never);
    return await fn(cmd);
  } catch (err) {
    throw new Error(explain(err, op));
  } finally {
    if (transport) {
      await transport.close().catch(() => {
        /* closing a device that already vanished is not an error worth reporting */
      });
    }
  }
}
