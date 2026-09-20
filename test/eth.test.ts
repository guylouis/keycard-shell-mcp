/**
 * The point of these tests is one specific failure: a signature that the Shell produced
 * correctly but that we reassemble wrongly, yielding a transaction that is well-formed,
 * broadcastable, and signed by the wrong address. That is silent and expensive, so each
 * test signs with a known key and checks we rebuild byte-for-byte what a real signer did.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, Transaction, SigningKey, Signature } from "ethers";

import {
  addressFromPublicKey,
  buildUnsigned,
  attachSignature,
  rawForShell,
  recoverTypedDataSigner,
  MAX_CALLDATA_BYTES,
} from "../src/eth.js";

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

test("recovers the signer of EIP-712 typed data without the device", async () => {
  // The device cannot tell us which key it used without a second approval, so the only
  // free check is to recover the address from the signature itself.
  const payload = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      Test: [{ name: "contents", type: "string" }],
    },
    primaryType: "Test",
    domain: { name: "Test", chainId: 1 },
    message: { contents: "hello" },
  };

  const { EIP712Domain: _drop, ...types } = payload.types;
  const raw = await wallet.signTypedData(payload.domain, types as never, payload.message);
  const sig = Signature.from(raw);

  const recovered = recoverTypedDataSigner(payload as never, {
    v: sig.v,
    r: sig.r.slice(2),
    s: sig.s.slice(2),
  });

  assert.equal(recovered, wallet.address);
});

test("refuses a typed-data signature that does not recover to the expected signer", async () => {
  const payload = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      Test: [{ name: "contents", type: "string" }],
    },
    primaryType: "Test",
    domain: { name: "Test" },
    message: { contents: "hello" },
  };

  const { EIP712Domain: _drop, ...types } = payload.types;
  const raw = await wallet.signTypedData(payload.domain, types as never, payload.message);
  const sig = Signature.from(raw);

  // Flip a byte of r. Recovery then either yields a different address or refuses
  // outright. What must never happen is quietly returning the expected signer.
  const tampered = sig.r.slice(2).replace(/^../, "aa");

  let recovered: string | undefined;
  try {
    recovered = recoverTypedDataSigner(payload as never, {
      v: sig.v,
      r: tampered,
      s: sig.s.slice(2),
    });
  } catch {
    recovered = undefined;
  }

  assert.notEqual(recovered, wallet.address);
});

test("the calldata cap is large enough for real transactions and small enough to display", () => {
  // A complex router call is a few kilobytes. The device cannot page through much more.
  assert.ok(MAX_CALLDATA_BYTES >= 8 * 1024, "must not reject ordinary contract calls");
  assert.ok(MAX_CALLDATA_BYTES <= 32 * 1024, "must stay within what the device can show");
});
