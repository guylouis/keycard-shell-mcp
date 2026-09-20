#!/usr/bin/env node
/**
 * keycard-shell-mcp — an MCP server that makes a Keycard Shell the signer.
 *
 * The model proposes a transaction. The Shell decodes it, shows it on its own screen,
 * and asks the holder for a PIN and a button press. Neither the private key nor the PIN
 * ever crosses the USB cable, and no amount of prompting makes the device sign by itself.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { withShell } from "./shell.js";
import {
  addressFromPublicKey,
  buildUnsigned,
  attachSignature,
  rawForShell,
  recoverTypedDataSigner,
  MAX_CALLDATA_BYTES,
} from "./eth.js";
import { fillMissing, provider, NO_RPC, RPC_URL } from "./rpc.js";

const DEFAULT_PATH = "m/44'/60'/0'/0/0";

/** Every signing tool says this, so the model narrates the wait instead of inventing a result. */
const NEEDS_HUMAN =
  "The Shell will display the details and wait for the holder to enter their PIN and press OK. " +
  "This tool cannot approve on their behalf and will block until they answer.";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const failure = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

async function attempt<T>(fn: () => Promise<T>, render: (v: T) => string) {
  try {
    return text(render(await fn()));
  } catch (err) {
    return failure(err instanceof Error ? err.message : String(err));
  }
}

const VERSION = "0.1.2";

/**
 * Answer --help and --version before opening the transport.
 *
 * Without this, any argument at all would start the server and silently block on stdin —
 * which, for someone checking the install worked, looks exactly like a hung terminal.
 */
const flag = process.argv[2];
if (flag === "--help" || flag === "-h") {
  console.log(
    [
      `keycard-shell-mcp ${VERSION}`,
      ``,
      `An MCP server that makes a Keycard Shell the signer for your AI agent.`,
      `It is not run by hand: your agent starts it and talks to it over stdin and stdout.`,
      ``,
      `If you are seeing this, the install worked. Next, tell your agent about it:`,
      `see https://github.com/guylouis/keycard-shell-mcp#step-3-tell-your-agent-about-it`,
      ``,
      `Options:`,
      `  -h, --help       Show this message`,
      `  -v, --version    Show the version`,
      ``,
      `Environment:`,
      `  KEYCARD_RPC_URL  Optional. Lets the server fill in gas and nonce, and broadcast`,
      `                   signed transactions. Unset, the server never touches the network.`,
    ].join("\n"),
  );
  process.exit(0);
}
if (flag === "--version" || flag === "-v") {
  console.log(VERSION);
  process.exit(0);
}

/**
 * An RPC URL usually carries an API key in its path. Printing it would copy that key into
 * the agent's context and its transcript, so report only enough to answer "is it set, and
 * which provider".
 */
function describeRpc(): string {
  if (!RPC_URL) return "not configured (signing works, broadcasting does not)";
  try {
    return `configured (${new URL(RPC_URL).host})`;
  } catch {
    return "configured";
  }
}

const server = new McpServer({ name: "keycard-shell", version: VERSION });

server.registerTool(
  "device_info",
  {
    title: "Read Keycard Shell device info",
    description:
      "Check that a Keycard Shell is connected and report its firmware version, database " +
      "version and serial number. Needs no approval on the device. Use this first when " +
      "anything looks wrong.",
    inputSchema: {},
  },
  async () =>
    attempt(
      () => withShell((cmd) => cmd.getAppConfiguration()),
      (i) =>
        [
          `Keycard Shell connected.`,
          `  Firmware:      ${i.fwVersion}`,
          `  Database:      ${i.dbVersion}`,
          `  Serial number: ${i.serialNumber}`,
          `  RPC endpoint:  ${describeRpc()}`,
        ].join("\n"),
    ),
);

server.registerTool(
  "get_address",
  {
    title: "Get an Ethereum address from the Shell",
    description:
      `Derive an Ethereum address from the Keycard held in the Shell. ${NEEDS_HUMAN} ` +
      `The address is computed locally from the public key; no private key leaves the card.`,
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe(`BIP32 derivation path. Defaults to ${DEFAULT_PATH}.`),
    },
  },
  async ({ path }) =>
    attempt(
      () =>
        withShell(async (cmd) => {
          const key = await cmd.getPublicKey(path ?? DEFAULT_PATH, false);
          return { address: addressFromPublicKey(key.publicKey), fingerprint: key.fingerprint };
        }, "public-key"),
      (r) => `${r.address}\n(master fingerprint ${r.fingerprint})`,
    ),
);

server.registerTool(
  "sign_transaction",
  {
    title: "Sign an Ethereum transaction on the Shell",
    description:
      `Sign an Ethereum transaction. The Shell decodes it and displays the destination, ` +
      `amount, chain and fee before asking for approval; for a known ERC-20 it shows the ` +
      `token and amount, and for an approve() call it shows the spender. ${NEEDS_HUMAN} ` +
      `Returns the signed transaction; it is NOT broadcast. ` +
      `Omitted fields are filled from the chain when an RPC endpoint is configured.`,
    inputSchema: {
      to: z.string().optional().describe("Recipient address. Omit only for contract creation."),
      value: z.string().optional().describe("Amount in wei, as a decimal string. Defaults to 0."),
      data: z.string().optional().describe("Calldata as a hex string starting with 0x."),
      chainId: z.number().int().optional().describe("Chain id. Required if no RPC is configured."),
      nonce: z.number().int().optional(),
      gasLimit: z.string().optional(),
      maxFeePerGas: z.string().optional().describe("In wei. EIP-1559 only."),
      maxPriorityFeePerGas: z.string().optional().describe("In wei. EIP-1559 only."),
      gasPrice: z.string().optional().describe("In wei. Legacy transactions only."),
      type: z.union([z.literal(0), z.literal(2)]).optional().describe("0 = legacy, 2 = EIP-1559. Defaults to 2."),
      path: z.string().optional().describe(`BIP32 path. Defaults to ${DEFAULT_PATH}.`),
    },
  },
  async (args) =>
    attempt(
      () =>
        withShell(async (cmd) => {
          const path = args.path ?? DEFAULT_PATH;

          const key = await cmd.getPublicKey(path, false);
          const from = addressFromPublicKey(key.publicKey);

          if (args.data && args.data !== "0x") {
            const bytes = (args.data.replace(/^0x/, "").length + 1) >> 1;
            if (bytes > MAX_CALLDATA_BYTES) {
              throw new Error(
                `This transaction carries ${bytes} bytes of calldata, more than the ` +
                  `${MAX_CALLDATA_BYTES} this server will send. The device cannot display that ` +
                  `much in full, so approving it would mean approving bytes nobody saw.`,
              );
            }
          }

          const filled = await fillMissing(from, args);
          for (const required of ["chainId", "nonce", "gasLimit"] as const) {
            if (filled[required] === undefined) {
              throw new Error(
                `Missing "${required}", and it cannot be filled automatically. ${NO_RPC}`,
              );
            }
          }

          const tx = buildUnsigned(filled as Parameters<typeof buildUnsigned>[0]);
          const sig = await cmd.signEthTransaction(path, rawForShell(tx));
          const signed = attachSignature(tx, sig);

          // The device knows which key it used; this proves the bytes we assembled agree.
          // A mismatch means a valid, broadcastable transaction from the wrong account.
          if (signed.from?.toLowerCase() !== from.toLowerCase()) {
            throw new Error(
              `Refusing to return this transaction. The device signed as ${from}, but the ` +
                `assembled transaction recovers to ${signed.from}. Nothing was broadcast.`,
            );
          }

          return { from, hash: signed.hash!, raw: signed.serialized };
        }, "transaction"),
      (r) =>
        [
          `Signed on the device.`,
          `  From: ${r.from}`,
          `  Hash: ${r.hash}`,
          ``,
          `Raw transaction (not broadcast):`,
          r.raw,
        ].join("\n"),
    ),
);

server.registerTool(
  "sign_typed_data",
  {
    title: "Sign EIP-712 typed data on the Shell",
    description:
      `Sign EIP-712 typed data. The Shell shows a dedicated screen for Permit, PermitSingle ` +
      `and Safe transactions, and the fully decoded JSON for anything else. There is no ` +
      `fallback that shows only a hash. ${NEEDS_HUMAN}`,
    inputSchema: {
      typedData: z
        .record(z.string(), z.unknown())
        .describe("The full EIP-712 payload: types, primaryType, domain and message."),
      path: z.string().optional().describe(`BIP32 path. Defaults to ${DEFAULT_PATH}.`),
    },
  },
  async ({ typedData, path }) =>
    attempt(
      () =>
        withShell(async (cmd) => {
          const sig = await cmd.signEIP712Message(path ?? DEFAULT_PATH, typedData);
          const v = sig.v.toString(16).padStart(2, "0");
          const signature = `0x${sig.r}${sig.s}${v}`;

          // Recovering costs no device round trip, and it is the only way to see which
          // key actually produced this signature.
          let signer: string;
          try {
            signer = recoverTypedDataSigner(typedData as never, sig);
          } catch (err) {
            throw new Error(
              `The device returned a signature that does not recover to any address: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          }

          return { signature, signer };
        }, "typed-data"),
      (r) =>
        [
          `Signed on the device.`,
          `  Signer:    ${r.signer}`,
          `  Signature: ${r.signature}`,
          ``,
          `Check that the signer is the address you expected.`,
        ].join("\n"),
    ),
);

server.registerTool(
  "broadcast_transaction",
  {
    title: "Broadcast a signed transaction",
    description:
      "Send a raw transaction that is already signed to the network. This does not touch " +
      "the Shell and needs no approval. The approval happened when it was signed. Requires " +
      "KEYCARD_RPC_URL to be configured.",
    inputSchema: {
      raw: z.string().describe("The signed raw transaction, starting with 0x, as returned by sign_transaction."),
    },
  },
  async ({ raw }) =>
    attempt(
      async () => {
        const p = provider();
        if (!p) throw new Error(NO_RPC);
        const sent = await p.broadcastTransaction(raw);
        return sent.hash;
      },
      (hash) => `Broadcast.\n  Hash: ${hash}`,
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("keycard-shell-mcp ready");
