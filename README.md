# keycard-shell-mcp

An MCP server that makes a [Keycard Shell](https://keycard.tech) the signer for your AI agent.

Your agent proposes a transaction. The Shell decodes it, shows it on its own screen, and waits
for you to enter your PIN and press OK. The private key never leaves the Keycard. The PIN never
crosses the USB cable. No amount of prompt injection makes the device sign by itself.

It speaks plain MCP over stdio, so it works with any agent that can run an MCP server. Claude
Code, Claude Desktop, Cursor, Codex, Hermes, Cline and Zed all qualify.

## What it protects, and what it does not

| | |
|---|---|
| **Private key** | Never leaves the Keycard secure element |
| **PIN** | Typed on the Shell. Never reaches your computer |
| **What you are signing** | Decoded and displayed by the Shell, not by the host |
| **Approval** | A physical button press. No software path can supply it |

An agent under prompt injection cannot sign. Neither can malware on your computer. Malware can
lie to you about what it is asking for, but the Shell shows you the real transaction, and you
are the one pressing the button.

The limit is what the Shell can decode. See [What the Shell shows you](#what-the-shell-shows-you).

## Setup

You need three things: a **Keycard Shell**, a **Keycard** to put in it, and a computer with an
**AI agent** you already use.

Setup takes about five minutes. There are two ways to do it. Pick one.

## Way 1: ask your agent to do it

This is easiest if you are not comfortable with a terminal. Your agent can run the commands for
you.

Copy this and paste it into your agent's chat:

> Please set up Keycard Shell signing for me. Follow the instructions at
> https://github.com/guylouis/keycard-shell-mcp/blob/main/AGENTS.md exactly, and tell me what
> you need me to do on the device.

Your agent will install everything and tell you when to plug in the Shell. Then jump to
[**Step 5, check it worked**](#step-5-check-it-worked). Do that step yourself.

Here is why that last part matters. This is the tool that stops your agent from spending your
money on its own. Step 5 is you confirming, with your own eyes, that the device really does ask
before it signs.

## Way 2: do it yourself

Five steps. Steps 1 to 3 happen on the computer. Step 4 happens on the device.

You will need a terminal. On a Mac, press **Command + Space**, type `Terminal`, press Enter. On
Windows, press the Start button and type `PowerShell`.

### Step 1. Check you have Node

This server runs on Node, which does not come with your agent. Check whether you already have
it:

```bash
node -v
```

**If you see a number like `v22.1.0`** (20 or higher), good. Go to step 2.

**If you see "command not found"**, go to [nodejs.org](https://nodejs.org). Download the LTS
version and run the installer like any other app. Then close the terminal, open a new one, and
run the check again.

### Step 2. Install the server

```bash
npm install -g @guylouis/keycard-shell-mcp
```

This takes a few seconds and prints a few lines. To confirm it worked:

```bash
keycard-shell-mcp --help
```

Any output at all means it is installed. If you get "command not found", see
[If something goes wrong](#if-something-goes-wrong).

### Step 3. Tell your agent about it

Find your agent below and follow only that one.

<details>
<summary><b>Claude Code</b></summary>

Run this:

```bash
claude mcp add keycard -- keycard-shell-mcp
```

</details>

<details>
<summary><b>Cursor</b></summary>

Open **Settings**, then **MCP**, then **Add new MCP server**. Or edit `~/.cursor/mcp.json`
directly and add:

```json
{
  "mcpServers": {
    "keycard": {
      "command": "keycard-shell-mcp"
    }
  }
}
```

If the file already has other servers in it, add `keycard` alongside them. Do not replace them.

</details>

<details>
<summary><b>Codex</b></summary>

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.keycard]
command = "keycard-shell-mcp"
```

</details>

<details>
<summary><b>Hermes</b></summary>

Add this to `~/.hermes/config.yaml`, under the `mcp_servers:` line that is already there:

```yaml
  keycard:
    command: keycard-shell-mcp
    enabled: true
```

</details>

<details>
<summary><b>Claude Desktop, Cline, Zed, or something else</b></summary>

Almost every host uses the same format. Find its MCP settings file and add:

```json
{
  "mcpServers": {
    "keycard": {
      "command": "keycard-shell-mcp"
    }
  }
}
```

Keep any servers already listed there.

If you cannot find the file, ask your agent where its MCP configuration file lives. It will know
for its own host.

</details>

**Then restart your agent** so it picks up the new server.

<details>
<summary><b>Linux users: one extra step before you continue</b></summary>

On Linux, USB devices are locked to the administrator by default. The Shell stays invisible
until you allow it. Paste this in one go. It will ask for your password:

```bash
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1209", ATTRS{idProduct}=="21f7", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/60-keycard-shell.rules && sudo udevadm control --reload-rules && sudo udevadm trigger
```

Then unplug the Shell and plug it back in.

macOS and Windows need nothing extra.

</details>

### Step 4. Set up the device

**This is where most problems come from.** The Shell only appears to your computer once it is
switched on *and* unlocked. Plugging it in is not enough.

1. **Plug it into your computer** with a USB-C cable. The cable must carry data. Some cheap
   cables only charge.
2. **Insert your Keycard.** The Shell switches on by itself when you do.
3. **Enter your PIN on the device.** Until you do, the computer cannot see it at all. A locked
   Shell looks exactly like a Shell that is not plugged in.
4. **Check USB is enabled.** Go to **Settings**, then **Shell**, then **USB-data**, and make
   sure it says **On**.

#### Worth changing: the timer that switches it off

**The Shell switches itself off after 3 minutes of no button presses.** When it does, it
disappears from your computer completely. You then have to switch it on and enter your PIN
again.

Three minutes is short when you work with an agent. The agent may spend a while preparing a
transaction before it asks the device for anything.

Change it under **Settings**, then **Shell**, then **Auto-off time**. The choices are **3, 5, 10
or 30 minutes, or Never**. For a working session, 30 minutes is comfortable. **Never** keeps it
awake until you switch it off by hand. That is convenient at a desk, and it is a decision to
make deliberately: a Shell left on and unlocked is a Shell anyone at your desk can use.

### Step 5. Check it worked

Ask your agent:

> What is my Ethereum address?

**Look at the Shell.** It should light up and ask you to approve. Enter your PIN and press
**OK**. Your agent then shows you the address.

That is the whole product in one action. Your agent asked, the device decided, and nothing
happened until you pressed a button.

## Optional: let it send transactions too

By default this server **signs** transactions but does not send them. To let it send as well,
give it a connection to the network by setting `KEYCARD_RPC_URL`.

With Claude Code:

```bash
claude mcp add keycard --env KEYCARD_RPC_URL=https://your-endpoint -- keycard-shell-mcp
```

On other hosts, add it to the `env` section of the same config you edited in step 3. A free
endpoint from Alchemy or Infura works, and so does a public RPC.

Signing and sending stay separate on purpose. Your approval happens once, on the device. Sending
afterwards is just network traffic. Without this setting the server never touches the network at
all.

## If something goes wrong

| What you see | What to do |
|---|---|
| `node: command not found` | Node is not installed, or the terminal needs restarting. See step 1. |
| `keycard-shell-mcp: command not found` | The install did not finish. Run step 2 again and read the output for errors. |
| Your agent does not list the Keycard tools | You missed the restart at the end of step 3. Close the agent fully and reopen it. |
| "No Keycard Shell found on USB" | **Nine times out of ten the device is simply locked or off.** Switch it on, insert the card, and **enter your PIN**. The computer cannot see a locked Shell. Then check **USB-data** is **On**, and that your cable carries data. |
| It worked a minute ago, now it is not found | The Shell switched itself off. It does that after **3 minutes** by default, and then it vanishes from USB. Switch it on and enter your PIN again. Consider raising the **Auto-off time** setting. |
| It asks for the PIN again in the middle of a session | Same cause. The timer expired while you were not pressing anything. Raise it. |
| It found the device but nothing signs | Look at the Shell. It is waiting for you. Signing needs your PIN and a button press every time. |

Still stuck? Ask your agent to run this and tell you what it says. This works on macOS:

```bash
ioreg -c IOHIDDevice -r -l | grep -q '"VendorID" = 4617' && echo "Shell visible" || echo "Shell not visible"
```

That checks whether your computer can see the device at all. It separates a cable or device
problem from a software one.

<details>
<summary><b>If the server sees no USB device at all, on any command</b></summary>

Recent versions of npm no longer let packages run their install steps automatically. That
stops the USB component from unpacking, so the server starts but sees nothing. This is now
the default behaviour, so most people will need this once:

```bash
npm approve-scripts node-hid usb && npm rebuild node-hid usb
```

Those two packages carry the prebuilt code that talks to USB. Nothing is compiled, and no
other package is given permission.

</details>

## Tools

| Tool | Approval on the device | What it does |
|---|---|---|
| `device_info` | No | Firmware, database and serial number. Start here when something is wrong. |
| `get_address` | Yes | Derives an Ethereum address. Computed from the public key on this machine. |
| `sign_transaction` | Yes | Signs an Ethereum transaction. Returns it signed. Does **not** broadcast. |
| `sign_typed_data` | Yes | Signs EIP-712 typed data. |
| `broadcast_transaction` | No | Sends a transaction that is already signed. Needs `KEYCARD_RPC_URL`. |

Signing and broadcasting are separate on purpose. Approval happens once, when you press OK on
the Shell. Broadcasting afterwards is just networking. Keeping them apart means the server runs
with no network access at all.

When `KEYCARD_RPC_URL` is set, `sign_transaction` fills in whatever you leave out: nonce, gas
limit, fees, chain id. Anything you supply explicitly is always kept.

## What the Shell shows you

The Shell decodes a transaction against three tables it carries in its own memory: a chain
registry, a token list, and a table of contract ABIs. What it can name, it names. What it
cannot, it shows as hex.

### Always shown

Signer, destination, chain, amount and fee. The chain is named when its id is in the registry.
That covers roughly 2,700 chains, from [chainid.network](https://chainid.network/chains.json).

### Token transfers

ERC-20 amounts carry the ticker and the correct number of decimals when the token is in the
list. That covers roughly 1,700 tokens, from the
[Uniswap Labs Default list](https://tokens.uniswap.org/). Coverage is heaviest on Ethereum,
Unichain, Arbitrum and Base.

A token outside that list still transfers correctly. You see a raw amount and a contract address
instead of `50 USDC`.

### Contract calls

**Around 900 function signatures are decoded by name, with their arguments broken out.**

Matching works on the four byte function selector, not on the contract address. So
`transfer(address,uint256)` is decoded on any token contract, not on a list of approved ones. A
selector the device knows is readable wherever it appears.

Roughly what is covered:

| Area | Examples |
|---|---|
| **ERC-20 and token basics** | `transfer`, `transferFrom`, `approve`, `permit`, `deposit`, `withdraw` |
| **DEX swaps and liquidity** | `swapExactTokensForTokens`, `addLiquidity`, `removeLiquidity` and their many variants |
| **Bridges** | deposit, relay and message passing calls across the major bridges |
| **Staking and restaking** | stake, delegate, unbond, validator and withdrawal calls |
| **Safe (multisig)** | `execTransaction`, `approveHash`, owner and threshold changes, modules, guards |
| **NFTs** | `safeTransferFrom`, `setApprovalForAll`, mint and burn |
| **Permit2** | the signature approval variants |

`approve` and `setApprovalForAll` matter most for an agent, because approvals are how agents get
drained. An ERC-20 `approve` gets its own screen naming the spender and the amount.

### What is not covered

Coverage is broad but not complete. Some router functions on newer protocols are absent. **An
unrecognised call is shown as hex**, with the ERC-8213 calldata digest. You are then confirming
a destination, an amount and a digest, not a meaning. Treat that as unverified, because it is.

To check a specific call before you rely on it, download the ABI list and search it:

```bash
curl -sL https://github.com/keycard-tech/eth-abi-repo/releases/latest/download/abi.json | grep -o '"name": "swapExactTokensForTokens"'
```

Replace the function name with the one you care about. Output means your device can read it.

### EIP-712 typed data

This is independent of the ABI table, and better covered:

* `Permit` and `PermitSingle` get a dedicated screen with the spender and the amount.
* Safe's `SafeTx` gets its own screen, across several pages.
* **Any other schema** is shown as fully decoded JSON. There is no fallback that shows only a
  hash.

### All three tables are public, and the build is reproducible

Nothing here is a claim you have to take on trust:

| Table | Source |
|---|---|
| ABIs | [`keycard-tech/eth-abi-repo`](https://github.com/keycard-tech/eth-abi-repo), its own public repo, released and versioned |
| Tokens | [tokens.uniswap.org](https://tokens.uniswap.org/) |
| Chains | [chainid.network](https://chainid.network/chains.json) |

Every published database version is listed at
[shell.keycard.tech/update/db-version-history](https://shell.keycard.tech/update/db-version-history),
with links to the exact sources it was built from. `tools/shell-db.py` in the firmware repository
rebuilds the binary from those sources. The result is identical byte for byte, except for the
trailing 64 byte signature. The procedure is in
[`docs/shell-db.md`](https://github.com/keycard-tech/keycard-shell/blob/master/docs/shell-db.md).

So you can verify exactly what your device will decode, rather than trusting the table above.
Counts are approximate and grow with each release. `device_info` reports which database version
your device is carrying.

## Development

```bash
npm install && npm test
```

The test suite runs without a device. It checks signature reassembly byte by byte against a real
signer, exercises the APDU layer against a fake transport, and boots the server over stdio to
check the tool surface and the path taken when no device is present.

## Built on

[`@choppu/shelljs`](https://github.com/choppu/shelljs) and
[`@choppu/shelljs-node-hid`](https://github.com/choppu/shelljs-node-hid), the Keycard Shell
communication layer, which does the HID framing and the APDU command set. The USB protocol itself
is documented in `docs/USB.md` in the
[firmware repository](https://github.com/keycard-tech/keycard-shell).

## License

MIT
