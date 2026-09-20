/**
 * Turns Shell status words and transport failures into sentences a user can act on.
 *
 * The Shell answers with ISO7816 status words (docs/USB.md in keycard-shell). Surfacing
 * "0x6982" to a chat window is useless; surfacing "you pressed Cancel" is not.
 */

export const SW = {
  OK: 0x9000,
  DENIED: 0x6982,
  CONDITIONS_NOT_SATISFIED: 0x6985,
  INVALID_DATA: 0x6a80,
  UNKNOWN_COMMAND: 0x6d00,
  INVALID_CLA: 0x6e00,
  NOT_SUPPORTED: 0x6501,
} as const;

const NO_DEVICE = [
  "No Keycard Shell found on USB. Check, in this order:",
  "  1. The Shell is switched on AND unlocked. It does not appear to the computer",
  "     until you enter your PIN on the device. A locked Shell looks exactly like",
  "     an unplugged one. This is the most common cause by a wide margin.",
  "  2. It has not switched itself off. It powers down after a few idle minutes and",
  "     then disappears from USB entirely. Raise the timeout under",
  "     Settings > Shell > Auto-off time.",
  "  3. A Keycard is inserted.",
  "  4. Settings > Shell > USB-data is set to On.",
  "  5. The cable carries data, not just power.",
].join("\n");

/** What the caller was doing, so 0x6A80 can say something true rather than something generic. */
export type Operation = "transaction" | "typed-data" | "psbt" | "public-key";

function invalidData(op: Operation | undefined): string {
  switch (op) {
    case "transaction":
      return (
        "The Shell rejected the transaction. The usual cause is a legacy transaction with no " +
        "EIP-155 chain binding, which can be replayed on any EVM chain. Send it as type 2, or " +
        "supply a chain id."
      );
    case "typed-data":
      return (
        "The Shell could not parse the EIP-712 payload. It must carry exactly four keys at the top " +
        'level, named "types", "primaryType", "domain" and "message". The parser on the device is ' +
        "stricter than most libraries about the shape of the values inside them."
      );
    case "psbt":
      return (
        "The Shell rejected the PSBT. A Taproot input needs a Keycard v4; with an older card the " +
        "signature does not come back as Schnorr and signing fails here."
      );
    case "public-key":
      return "The Shell rejected the derivation path. Check it has at most 10 elements.";
    default:
      return "The Shell rejected the data it was sent.";
  }
}

function forStatus(sw: number, op?: Operation): string | undefined {
  switch (sw) {
    case SW.DENIED:
      return "Rejected on the device. You pressed Cancel on the Shell, so nothing was signed.";
    case SW.CONDITIONS_NOT_SATISFIED:
      return "The Shell refused the command. Usually this means no Keycard is inserted, or the device is busy with another screen.";
    case SW.INVALID_DATA:
      return invalidData(op);
    case SW.UNKNOWN_COMMAND:
      return "The Shell does not know this command. The firmware is probably older than this tool expects.";
    case SW.INVALID_CLA:
      return "The Shell rejected the command class. This is a bug in this tool, not something you can fix.";
    case SW.NOT_SUPPORTED:
      return "This Shell does not support that feature.";
  }
  if ((sw & 0xff00) === 0x6f00) {
    return `Internal error on the Shell (0x${sw.toString(16)}). Switch it off and on, then try again.`;
  }
  return undefined;
}

/** Best-effort human explanation for anything thrown by shelljs or node-hid. */
export function explain(err: unknown, op?: Operation): string {
  const e = err as { statusCode?: number; name?: string; message?: string };

  if (typeof e?.statusCode === "number") {
    return forStatus(e.statusCode, op) ?? `The Shell returned status 0x${e.statusCode.toString(16)}.`;
  }

  const name = e?.name ?? "";
  const message = e?.message ?? String(err);

  if (name === "CantOpenDevice" || /cannot open|no device|not found/i.test(message)) {
    return NO_DEVICE;
  }
  if (name === "DisconnectedDevice" || name === "DisconnectedDeviceDuringOperation") {
    return "The Shell was unplugged or powered off while the command was running. Nothing was signed.";
  }
  if (name === "UnresponsiveDeviceError") {
    return "The Shell did not answer. It may be waiting on a screen. Look at the device.";
  }
  if (/permission|access denied|EACCES/i.test(message)) {
    return [
      "Permission denied opening the USB device.",
      "On Linux, install the udev rule (see README) and replug the Shell.",
    ].join(" ");
  }
  return message;
}

export { NO_DEVICE };
