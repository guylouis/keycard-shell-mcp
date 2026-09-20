/**
 * The point of these tests is one specific failure: a signature that the Shell produced
 * correctly but that we reassemble wrongly, yielding a transaction that is well-formed,
 * broadcastable, and signed by the wrong address. That is silent and expensive, so each
 * test signs with a known key and checks we rebuild byte-for-byte what a real signer did.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, Transaction, SigningKey } from "ethers";

import { addressFromPublicKey, buildUnsigned, attachSignature, rawForShell } from "../src/eth.js";

const KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d0f1b4a0f4e0e2b1";
const wallet = new Wallet(KEY);

test("derives the same address ethers does, from an uncompressed key", () => {
  const uncompressed = SigningKey.computePublicKey(wallet.signingKey.publicKey, false);
  assert.equal(addressFromPublicKey(uncompressed), wallet.address);
});

test("derives the address whether or not the key carries a 0x prefix", () => {
  const uncompressed = SigningKey.computePublicKey(wallet.signingKey.publicKey, false);
  assert.equal(addressFromPublicKey(uncompressed.slice(2)), wallet.address);
});

test("rebuilds an EIP-1559 transaction identically to a real signer", async () => {
  const fields = {
    to: "0x28ee52a8f3d6e5d15f8b131996950d7f296c7952",
    value: "1000000000000000",
    chainId: 1,
    nonce: 7,
    gasLimit: "21000",
    maxFeePerGas: "30000000000",
    maxPriorityFeePerGas: "1000000000",
    type: 2 as const,
  };

  const expected = Transaction.from(await wallet.signTransaction(buildUnsigned(fields)));

  // What the Shell hands back for a type-2 transaction: v is the bare recovery id.
  const shellSignature = {
    r: expected.signature!.r.slice(2),
    s: expected.signature!.s.slice(2),
    v: expected.signature!.yParity.toString(16),
  };

  const rebuilt = attachSignature(buildUnsigned(fields), shellSignature);

  assert.equal(rebuilt.serialized, expected.serialized);
  assert.equal(rebuilt.from, wallet.address);
});

test("rebuilds a legacy EIP-155 transaction identically to a real signer", async () => {
  const fields = {
    to: "0x28ee52a8f3d6e5d15f8b131996950d7f296c7952",
    value: "1000000000000000",
    chainId: 1,
    nonce: 7,
    gasLimit: "21000",
    gasPrice: "20000000000",
    type: 0 as const,
  };

  const expected = Transaction.from(await wallet.signTransaction(buildUnsigned(fields)));

  // Legacy: the firmware returns v = chainID * 2 + 35 + recid.
  const recid = expected.signature!.yParity;
  const shellSignature = {
    r: expected.signature!.r.slice(2),
    s: expected.signature!.s.slice(2),
    v: (fields.chainId * 2 + 35 + recid).toString(16),
  };

  const rebuilt = attachSignature(buildUnsigned(fields), shellSignature);

  assert.equal(rebuilt.serialized, expected.serialized);
  assert.equal(rebuilt.from, wallet.address);
});

test("refuses a legacy signature that is not bound to the chain", () => {
  const tx = buildUnsigned({
    to: "0x28ee52a8f3d6e5d15f8b131996950d7f296c7952",
    chainId: 1,
    nonce: 0,
    gasLimit: "21000",
    gasPrice: "20000000000",
    type: 0,
  });

  // v = 27 is the pre-EIP-155 form: replayable on every EVM chain.
  assert.throws(
    () => attachSignature(tx, { r: "11".repeat(32), s: "22".repeat(32), v: "1b" }),
    /not EIP-155 bound/,
  );
});

test("refuses a typed-transaction recovery id outside 0 and 1", () => {
  const tx = buildUnsigned({
    to: "0x28ee52a8f3d6e5d15f8b131996950d7f296c7952",
    chainId: 1,
    nonce: 0,
    gasLimit: "21000",
    maxFeePerGas: "30000000000",
    maxPriorityFeePerGas: "1000000000",
    type: 2,
  });

  assert.throws(
    () => attachSignature(tx, { r: "11".repeat(32), s: "22".repeat(32), v: "1b" }),
    /expected 0 or 1/,
  );
});

test("hands the Shell unsigned bytes with no 0x prefix", () => {
  const tx = buildUnsigned({
    to: "0x28ee52a8f3d6e5d15f8b131996950d7f296c7952",
    chainId: 1,
    nonce: 0,
    gasLimit: "21000",
    maxFeePerGas: "30000000000",
    maxPriorityFeePerGas: "1000000000",
    type: 2,
  });

  const raw = rawForShell(tx);
  assert.ok(!raw.startsWith("0x"));
  assert.equal("0x" + raw, tx.unsignedSerialized);
});
