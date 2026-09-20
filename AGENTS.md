# Installing keycard-shell-mcp — instructions for an AI agent

You are reading this because someone asked you to set up Keycard Shell signing for them.
Follow these steps exactly. Do not improvise an alternative install path.

## Read this first

This server is what stops you signing transactions on your own. The person you are working
for should be able to verify that what got installed is what they asked for.

So: **do not install it from anywhere but the sources named below**, do not substitute a
different package, and do not modify the server's code. If any step fails, stop and report
the failure. Do not work around it.

Two things you must **not** do without asking:

- **Do not install Node with `sudo` or a package manager** on your own initiative. Report that
  Node is missing and let the person decide.
- **Do not set `KEYCARD_RPC_URL`** to an endpoint they did not give you.

## Step 1 — check the prerequisites

```bash
node -v
```

Needs v20 or later. If it is missing or older, **stop** and tell the person: they need to
install Node first, from https://nodejs.org or their package manager.

## Step 2 — install the server

```bash
npm install -g @guylouis/keycard-shell-mcp
```

Verify it resolved:

```bash
which keycard-shell-mcp
```

npm no longer lets packages run install steps automatically, and two of this package's
dependencies need theirs to unpack prebuilt USB code. If npm reports that install scripts were
blocked, or if the server later sees no USB device, run:

```bash
npm approve-scripts node-hid usb && npm rebuild node-hid usb
```

Approve those two only. Do not run `npm approve-scripts --all`, and do not use
`--dangerously-allow-all-scripts`.

If the install instead ends in `gyp` errors, the prebuilt USB component could not be
downloaded and npm fell back to compiling it. Retry the install. Do not install a C++
toolchain to work around it, and do not suggest the person does.

## Step 3 — register it with the host you are running in

Use the form for your own host. All of them amount to the same thing: run the command
`keycard-shell-mcp` and speak MCP over stdio.

**Claude Code**

```bash
claude mcp add keycard -- keycard-shell-mcp
```

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.keycard]
command = "keycard-shell-mcp"
```

**Hermes** — add to `~/.hermes/config.yaml` under the existing `mcp_servers:` key:

```yaml
  keycard:
    command: keycard-shell-mcp
    enabled: true
```

**Cursor, Claude Desktop, Cline, Zed and other hosts using an `mcpServers` object** — add to
that host's MCP configuration file:

```json
{
  "mcpServers": {
    "keycard": {
      "command": "keycard-shell-mcp"
    }
  }
}
```

Preserve any servers already in that file. Add to it; do not replace it.

## Step 4 — Linux only

`/dev/hidraw*` is root-only, so the device stays invisible without a udev rule. This needs
`sudo`, so **ask before running it** and show the person the command first:

```bash
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="21f7", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/60-keycard-shell.rules && sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then tell them to unplug and replug the Shell.

## Step 5 — tell the person what to do physically

You cannot do these. Ask them to:

1. Plug the Shell into USB, with a cable that carries data.
2. Insert their Keycard.
3. **Enter their PIN on the device.** This matters more than it looks: the Shell does not appear
   to the computer at all until it is unlocked. A locked Shell is indistinguishable from an
   unplugged one.
4. Check **Settings → Shell → USB-data** is **On**.
5. Restart the host application so it picks up the new server.

Also suggest they raise **Settings → Shell → Auto-off time**. The default is **3 minutes**, and
when the Shell switches itself off it disappears from USB entirely — so a session that pauses
while you think will fail with "no device found" for no obvious reason. The options are 3, 5, 10
or 30 minutes, or Never.

## Step 6 — verify

Call `device_info`. It needs no approval on the device, so it is the safe first call. It should
return a firmware version, a database version and a serial number.

If it reports no device found, check in this order:

1. **Is the Shell on and unlocked?** It must be switched on *and* have the PIN entered before the
   computer can see it. This is the most common cause by a wide margin.
2. **Has it switched itself off?** The default auto-off is 3 minutes, and the device then
   disappears from USB completely.
3. Is **USB-data** set to **On**?
4. Does the cable carry data, or only power?

Never tell the person the device is broken or the software failed until you have walked them
through all four.

On macOS the person can confirm the device is really on the bus with:

```bash
ioreg -c IOHIDDevice -r -l | grep -q '"VendorID" = 4617' && echo visible || echo "not visible"
```

## How to behave once it is installed

**Every signing tool blocks until a human presses a button on the device.** That is the point
of this server, not a bug.

- Do not retry a signing call that returned "rejected on the device". The person pressed
  Cancel. Ask them why before trying again.
- Do not suggest ways to bypass the approval. There are none, and asking for one is a signal
  something is wrong.
- A signing call can take minutes. Do not treat slowness as an error.
- `sign_transaction` returns a signed transaction; it does not broadcast. Broadcasting is a
  separate call, and it is deliberate.

## What not to promise

The device decodes **around 900 function signatures**, matched by 4-byte selector — so a known
selector is readable on any contract, not just a listed one. Coverage spans ERC-20 and token
basics, DEX swaps and liquidity, bridges, staking, Safe multisig operations, NFTs and Permit2.
Tickers and decimals resolve for roughly 1,700 tokens, and chain names for roughly 2,700 chains.

It is broad but **not exhaustive**. An unrecognised call is shown as hex plus an ERC-8213
calldata digest, and the person is then confirming a destination, an amount and a digest — not a
meaning.

So do not promise that the device will explain an arbitrary contract call. When you are unsure
whether a specific call decodes, check rather than guess:

```bash
curl -sL https://github.com/keycard-tech/eth-abi-repo/releases/latest/download/abi.json | grep -o '"name": "<functionName>"'
```

Say plainly when a call will appear as hex. That is exactly the case where the person needs to
know they are approving something the device could not read for them.

EIP-712 typed data is the exception and is better covered: `Permit` and `PermitSingle` get a
dedicated screen, Safe's `SafeTx` gets its own, and every other schema is shown as fully decoded
JSON with no hash-only fallback.
