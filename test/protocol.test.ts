/**
 * Exercises the real @choppu/shelljs command set against a fake transport, so the APDUs
 * we send and the responses we parse are checked without a device on the desk.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, SigningKey } from "ethers";
import { ShellJS } from "@choppu/shelljs";

import { explain, SW } from "../src/errors.js";
import { addressFromPublicKey } from "../src/eth.js";

interface Sent {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: Buffer;
}

/** Stands in for a Shell: records what was sent, replays a canned response. */
function fakeTransport(responses: Buffer[]) {
  const sent: Sent[] = [];
  let next = 0;
  const transport = {
    send(cla: number, ins: number, p1: number, p2: number, data?: Buffer) {
      sent.push({ cla, ins, p1, p2, data });
      return Promise.resolve(responses[next++] ?? Buffer.alloc(0));
    },
  };
  return { transport, sent };
}

const wallet = new Wallet("0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d0f1b4a0f4e0e2b1");
const uncompressed = Buffer.from(
  SigningKey.computePublicKey(wallet.signingKey.publicKey, false).slice(2),
  "hex",
);

function publicKeyResponse(): Buffer {
  const fingerprint = Buffer.from("deadbeef", "hex");
  const chainCode = Buffer.alloc(32, 0xab);
  return Buffer.concat([
    Buffer.from([fingerprint.length]),
    fingerprint,
    Buffer.from([uncompressed.length]),
    uncompressed,
    Buffer.from([chainCode.length]),
    chainCode,
  ]);
}

test("GET PUBLIC sends the documented APDU and encodes the BIP32 path", async () => {
  const { transport, sent } = fakeTransport([publicKeyResponse()]);
  const cmd = new ShellJS.Commands(transport as never);

  await cmd.getPublicKey("m/44'/60'/0'/0/0", true);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].cla, 0xe0, "CLA is fixed at 0xE0");
  assert.equal(sent[0].ins, 0x02, "GET PUBLIC is INS 0x02");
  assert.equal(sent[0].p2, 0x01, "P2 = 0x01 requests the chain code");

  // 1 byte of depth, then 4 bytes per element, big-endian, hardened bits set.
  const data = sent[0].data!;
  assert.equal(data[0], 5, "five path elements");
  assert.equal(data.length, 1 + 5 * 4);
  assert.equal(data.readUInt32BE(1), 0x8000002c, "44' hardened");
  assert.equal(data.readUInt32BE(5), 0x8000003c, "60' hardened");
});

test("GET PUBLIC parsing yields a key that derives the right address", async () => {
  const { transport } = fakeTransport([publicKeyResponse()]);
  const cmd = new ShellJS.Commands(transport as never);

  const key = await cmd.getPublicKey("m/44'/60'/0'/0/0", true);

  assert.equal(key.fingerprint, "deadbeef");
  assert.equal(key.publicKey, uncompressed.toString("hex"));
  assert.equal(key.chainCode, "ab".repeat(32));
  assert.equal(addressFromPublicKey(key.publicKey), wallet.address);
});

test("GET DEVICE INFO parses firmware, database, serial and key", async () => {
  const response = Buffer.concat([
    Buffer.from([1, 4, 0]), // firmware 1.4.0
    Buffer.from([0x01, 0x35, 0x00, 0xcc]), // database date 20250828, big-endian
    Buffer.alloc(16, 0x11), // device UID
    Buffer.alloc(33, 0x22), // device public key
  ]);
  const { transport, sent } = fakeTransport([response]);
  const cmd = new ShellJS.Commands(transport as never);

  const info = await cmd.getAppConfiguration();

  assert.equal(sent[0].ins, 0x06, "GET DEVICE INFO is INS 0x06");
  assert.equal(info.fwVersion, "1.4.0");
  assert.equal(info.dbVersion, 20250828);
  assert.equal(info.serialNumber, "11".repeat(16));
});

test("status words become sentences, not hex codes", () => {
  assert.match(explain({ statusCode: SW.DENIED }), /pressed Cancel/);
  assert.match(explain({ statusCode: SW.CONDITIONS_NOT_SATISFIED }), /no Keycard is inserted/);
  assert.match(explain({ statusCode: SW.INVALID_DATA, }, "transaction"), /EIP-155/);
  assert.match(explain({ statusCode: SW.INVALID_DATA }, "typed-data"), /EIP-712/);
  assert.match(explain({ statusCode: SW.INVALID_DATA }, "psbt"), /Keycard v4/);
  assert.match(explain({ statusCode: SW.INVALID_DATA }), /rejected the data/);
  assert.match(explain({ statusCode: 0x6f42 }), /Internal error/);
});

test("a missing device leads with the real top cause, not a flat checklist", () => {
  const msg = explain({ name: "CantOpenDevice", message: "cannot open device" });

  // A locked Shell is invisible on USB, and that is what people actually hit.
  // It has to come first, not be buried under "is it plugged in".
  assert.match(msg, /unlocked/);
  assert.match(msg, /enter your PIN/);
  assert.ok(
    msg.indexOf("PIN") < msg.indexOf("USB-data"),
    "the PIN must be mentioned before the USB-data setting",
  );

  assert.match(msg, /auto-off is 3 minutes/i);
  assert.match(msg, /Keycard is inserted/);
  assert.match(msg, /USB-data/);
});

test("a Linux permission failure points at the udev rule", () => {
  assert.match(explain(new Error("EACCES: permission denied, open '/dev/hidraw0'")), /udev/);
});
