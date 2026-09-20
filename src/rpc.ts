/**
 * Optional JSON-RPC support.
 *
 * Signing needs no network at all. But a signed transaction nobody can broadcast is a
 * hex string, so when KEYCARD_RPC_URL is set we also fill in the boring fields (nonce,
 * gas, fees) and offer to broadcast. With no URL set, the server still signs; it just
 * requires the caller to supply every field itself.
 */

import { JsonRpcProvider } from "ethers";

export const RPC_URL = process.env.KEYCARD_RPC_URL;

let cached: JsonRpcProvider | undefined;

export function provider(): JsonRpcProvider | undefined {
  if (!RPC_URL) return undefined;
  if (!cached) cached = new JsonRpcProvider(RPC_URL);
  return cached;
}

export const NO_RPC =
  "No RPC endpoint is configured, so this server cannot reach a chain.\n" +
  "Set KEYCARD_RPC_URL in the MCP server config to enable it.";

export interface Fillable {
  chainId?: number;
  nonce?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
  type?: 0 | 2;
  to?: string;
  value?: string;
  data?: string;
}

/**
 * Fill whatever the caller left out, from the chain. Anything already supplied is kept —
 * an explicit value from the user always wins over an estimate.
 */
export async function fillMissing(from: string, f: Fillable): Promise<Fillable> {
  const p = provider();
  if (!p) return f;

  const out: Fillable = { ...f };

  if (out.chainId === undefined) {
    out.chainId = Number((await p.getNetwork()).chainId);
  }
  if (out.nonce === undefined) {
    out.nonce = await p.getTransactionCount(from, "pending");
  }
  if (out.gasLimit === undefined) {
    const estimate = await p.estimateGas({
      from,
      to: out.to,
      value: out.value ?? "0",
      data: out.data ?? "0x",
    });
    out.gasLimit = estimate.toString();
  }

  const type = out.type ?? 2;
  if (type === 2 && (out.maxFeePerGas === undefined || out.maxPriorityFeePerGas === undefined)) {
    const fees = await p.getFeeData();
    out.maxFeePerGas ??= fees.maxFeePerGas?.toString();
    out.maxPriorityFeePerGas ??= fees.maxPriorityFeePerGas?.toString();
  }
  if (type === 0 && out.gasPrice === undefined) {
    const fees = await p.getFeeData();
    out.gasPrice = fees.gasPrice?.toString();
  }

  return out;
}
