/**
 * Smoke test for the published package, run against a global install.
 *
 * This does not test the repository. It installs @guylouis/keycard-shell-mcp from npm the
 * way the README tells a user to, then talks to the installed binary as an agent would:
 * over stdio, speaking MCP. It answers one question — does following the README leave you
 * with a working server?
 *
 * It cannot test signing. That needs a physical Shell and a human pressing a button.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const [command, ...args] = process.argv.slice(2);
assert.ok(command, "usage: smoke.mjs <command> [args...]");

const EXPECTED_TOOLS = [
  "broadcast_transaction",
  "device_info",
  "get_address",
  "sign_transaction",
  "sign_typed_data",
];

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command, args }));

try {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, EXPECTED_TOOLS, "the installed server exposes the wrong tools");
  console.log(`  tools: ${names.join(", ")}`);

  // No Shell is attached to a CI runner, so this must fail in the documented way rather
  // than crash. That error is the first thing most users will ever see.
  const result = await client.callTool({ name: "device_info", arguments: {} });
  assert.equal(result.isError, true, "device_info should report an error with no device");

  const message = result.content[0].text;
  assert.match(message, /No Keycard Shell found/, "wrong no-device message");
  assert.match(message, /enter your PIN/, "no-device message must lead with the PIN");
  console.log("  no-device path: correct message");

  // The RPC URL may carry an API key; it must never be echoed back.
  assert.ok(!message.includes("SECRET"), "device_info leaked the RPC URL");

  console.log("OK");
} finally {
  await client.close();
}
