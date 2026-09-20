/**
 * Ethereum glue around the Shell's raw signing commands.
 *
 * The Shell signs bytes. It does not build transactions and it does not derive addresses,
 * so both happen here. GET PUBLIC returns an uncompressed 65-byte key; the address is
 * derived from it locally and never comes off the device.
 */

import { Transaction, Signature, computeAddress, getAddress } from "ethers";

export interface ShellSignature {
  v: string;
  r: string;
  s: string;
}

export interface TxFields {
  to?: string;
  value?: string;
  data?: string;
  chainId: number;
  nonce: number;
  gasLimit: string;
  type?: 0 | 2;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

const hex = (s: string) => (s.startsWith("0x") ? s : "0x" + s);

/** Ethereum address for an uncompressed public key as returned by GET PUBLIC. */
export function addressFromPublicKey(publicKeyHex: string): string {
  return computeAddress(hex(publicKeyHex));
}

/** Build the unsigned transaction the Shell will be asked to sign. */
export function buildUnsigned(f: TxFields): Transaction {
  const type = f.type ?? 2;

  const tx = Transaction.from({
    type,
    to: f.to ? getAddress(f.to) : null,
    value: f.value ?? "0",
    data: f.data ?? "0x",
    chainId: f.chainId,
    nonce: f.nonce,
    gasLimit: f.gasLimit,
    ...(type === 2
      ? {
          maxFeePerGas: f.maxFeePerGas,
          maxPriorityFeePerGas: f.maxPriorityFeePerGas,
        }
      : { gasPrice: f.gasPrice }),
  });

  return tx;
}

/**
 * Reattach the Shell's signature to the transaction.
 *
 * The device returns different things per type, per the firmware:
 * legacy is EIP-155 encoded (v = chainId * 2 + 35 + recid), while EIP-1559 and
 * EIP-2930 return the bare recovery id.
 */
export function attachSignature(tx: Transaction, sig: ShellSignature): Transaction {
  const v = parseInt(sig.v, 16);
  const r = hex(sig.r);
  const s = hex(sig.s);

  if (tx.type === 0) {
    const chainId = Number(tx.chainId);
    const recid = v - 35 - 2 * chainId;
    if (recid !== 0 && recid !== 1) {
      throw new Error(
        `The Shell returned v=${v}, which is not EIP-155 bound to chain ${chainId}. ` +
          `Refusing to build a replayable transaction.`,
      );
    }
    tx.signature = Signature.from({ r, s, v });
  } else {
    if (v !== 0 && v !== 1) {
      throw new Error(`The Shell returned v=${v} for a type ${tx.type} transaction; expected 0 or 1.`);
    }
    tx.signature = Signature.from({ r, s, yParity: v as 0 | 1 });
  }

  return tx;
}

/** The exact bytes the Shell expects: unsigned serialisation, no 0x prefix. */
export function rawForShell(tx: Transaction): string {
  return tx.unsignedSerialized.slice(2);
}
