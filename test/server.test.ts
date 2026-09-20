/**
 * Boots the real server over stdio and talks to it as any MCP client would: list the tools, then
 * call one. With no Shell on the bus the call must fail in a way a human can act on —
 * that error path is the one users will hit first, so it is worth a test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entrypoint = fileURLToPath(new URL("../src/index.js", import.meta.url));

async function connect() {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [entrypoint] }),
  );
  return client;
}

test("the server exposes exactly the tools we mean to ship", async () => {
  const client = await connect();
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "broadcast_transaction",
      "device_info",
      "get_address",
      "sign_transaction",
      "sign_typed_data",
    ]);
  } finally {
    await client.close();
  }
});

test("every signing tool warns the agent it cannot approve by itself", async () => {
  const client = await connect();
  try {
    const tools = (await client.listTools()).tools;
    for (const name of ["get_address", "sign_transaction", "sign_typed_data"]) {
      const tool = tools.find((t) => t.name === name)!;
      assert.match(tool.description!, /cannot approve/, `${name} must say so`);
    }
  } finally {
    await client.close();
  }
});

test("with no Shell attached, device_info says what to check", async () => {
  const client = await connect();
  try {
    const result = await client.callTool({ name: "device_info", arguments: {} });
    assert.equal(result.isError, true);

    const message = (result.content as { text: string }[])[0].text;
    assert.match(message, /No Keycard Shell found/);
    assert.match(message, /USB-data/);
  } finally {
    await client.close();
  }
});

test("broadcasting without an RPC endpoint explains how to configure one", async () => {
  const client = await connect();
  try {
    const result = await client.callTool({
      name: "broadcast_transaction",
      arguments: { raw: "0x02f8" },
    });
    assert.equal(result.isError, true);
    assert.match((result.content as { text: string }[])[0].text, /KEYCARD_RPC_URL/);
  } finally {
    await client.close();
  }
});

test("--help exits cleanly instead of blocking on stdin", async () => {
  // The README tells people to run this to check the install worked. If it started the
  // server instead, it would hang their terminal and look like a failure.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const { stdout } = await promisify(execFile)(process.execPath, [entrypoint, "--help"]);

  assert.match(stdout, /keycard-shell-mcp/);
  assert.match(stdout, /the install worked/);
});

test("--version prints the package version", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readFile } = await import("node:fs/promises");

  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const { stdout } = await promisify(execFile)(process.execPath, [entrypoint, "--version"]);

  assert.equal(stdout.trim(), pkg.version);
});
