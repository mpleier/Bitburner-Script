# Bitburner Coding Contract Automation

Finds every `*.cct` coding contract on every server you can reach, solves it with
a built-in solver, and submits it.

**Root access is not required.** The Coding Contract API works on any server your
script can see, so contracts on servers you cannot hack are still solved. If you
*do* want those servers rooted for hacking, pass `--open-ports`.

---

## Quick start: load it in game

### Step 1 — create the installer (one time only)

Open the **Terminal** in Bitburner and create a file called `install.js`:

```text
nano install.js
```

Paste this into the editor and save with **Ctrl+S**:

```js
// install.js - pulls the contract automation from GitHub and starts it.
export async function main(ns) {
  const base = "https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/";
  const files = ["contractRunner.ts", "contracts.ts"];
  for (const f of files) await ns.wget(base + f, f);

  // The runner needs 28 GB, so pick the biggest server you already have root on.
  let host = ns.getHostname(), ram = ns.getServerMaxRam(host);
  const seen = new Set(), queue = ["home"];
  while (queue.length) {
    const h = queue.shift();
    if (seen.has(h)) continue;
    seen.add(h);
    for (const n of ns.scan(h)) if (!seen.has(n)) queue.push(n);
  }
  for (const h of seen) {
    const s = ns.getServer(h);
    if (s.hasAdminRights && s.maxRam >= 28 && s.maxRam > ram) { host = h; ram = s.maxRam; }
  }

  if (host !== ns.getHostname()) ns.scp(files, host);
  const pid = ns.exec("contractRunner.ts", host, 1, ...ns.args);
  ns.tprint(pid ? `Running contractRunner.ts on ${host} (${ram} GB)`
                 : `Could not start: you need root on ${host}`);
}
```

That is the entire installer. `ns.wget()` (RAM cost **0 GB**) downloads the two
real files straight from GitHub, so you never have to copy-paste the 40 KB of
solver code into the game.

> **Heads up:** `contractRunner.ts` needs **28 GB of RAM** and root on the server
> that runs it. If you do not have such a server yet, the snippet above prints
> which server is the biggest rooted one you have. Root a bigger server first
> (see `--open-ports` below).


### Step 2 — run it

```text
run install.js
```

You should see something like:

```text
Started contractRunner.ts on n0006 (pid 1) args: (defaults)
Round 1: 14 contracts | 14 solved | 0 failed | 0 unsupported | 0 not rootable
```

Watch the log with:

```text
tail contractRunner.ts
```

### Step 3 — keep it running

```text
run install.js --loop --interval 30000
```

`--loop` rescans the network every 30 seconds, so contracts you discover later
are picked up automatically.

---

## Flags

Everything after `install.js` is forwarded to `contractRunner.ts`.

| Flag | Effect |
|---|---|
| `--open-ports` | Also open ports and NUKE servers you can root (useful for hacking). Off by default. |
| `--dry-run` | Print the answers but submit nothing. Great for a first test. |
| `--loop` | Rescan the network repeatedly instead of running once. |
| `--interval 30000` | Delay between rounds when `--loop` is used (ms). |
| `--max 50` | Stop after N contracts in a round. |
| `--host CSEC` | Only look at one server. |
| `--selftest` | Run the solver test suite and exit. |
| `--no-run` | Installer only: download the files, don't start the runner. |
| `--ref main` | Which branch/tag of the repo to download from. |
| `--server n0006` | Force which server the runner is installed on. |

Examples:

```text
run install.js --dry-run                      # safe test run
run install.js --open-ports --loop            # solve + root servers, forever
run install.js --host CSEC                    # only CSEC
run install.js --selftest                     # verify the solvers
```

---

## Updating

Just run the installer again:

```text
run install.js
```

It re-downloads the latest `contractRunner.ts` and `contracts.ts` from GitHub and
restarts the runner. To pull from a different branch:

```text
run install.js --ref dev
```

---

## Full installer (picks the best server)

The version committed as [`scripts/install.js`](scripts/install.js) is the same
idea plus a few extra flags (`--ref`, `--server`, `--no-run`) and clearer error
messages:

1. downloads both files,
2. BFS-scans the whole network,
3. picks the **biggest server you already have root on** with at least 28 GB RAM,
4. copies the files there and starts the runner.

<details>
<summary>Click to expand <code>install.js</code></summary>

```js
/**
 * install.js - one-click installer / updater for the contract automation.
 *
 *   nano install.js      -> paste this file, Ctrl+S to save
 *   run install.js       -> download from GitHub and start
 *   run install.js --open-ports --loop
 */

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";
const FILES = ["contractRunner.ts", "contracts.ts"];
const RAM_NEEDED = 28;

export async function main(ns) {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const ref = flag(args, "--ref") ?? DEFAULT_REF;
  const forcedServer = flag(args, "--server");
  const noRun = args.includes("--no-run");
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();

  // 1. Download the scripts onto the server this installer is running on.
  for (const file of FILES) {
    const url = base + file;
    if (!(await ns.wget(url, file, here))) {
      ns.tprint(`FAILED to download ${url}`);
      ns.tprint("Check the branch name (--ref) or paste the file manually with nano.");
      return;
    }
    ns.print(`downloaded ${file} (${ref})`);
  }

  // 2. Pick the biggest server you already have root on that can hold the runner.
  const target = forcedServer ?? bestHost(ns, here);

  if (target !== here) {
    ns.scp(FILES, target, here);
    ns.print(`copied ${FILES.join(", ")} -> ${target}`);
  }

  if (noRun) {
    ns.tprint(`Installed ${FILES.join(", ")} on ${target}. Start it with: run contractRunner.ts`);
    return;
  }

  if (ns.getServerMaxRam(target) < RAM_NEEDED) {
    ns.tprint(
      `contractRunner.ts needs ${RAM_NEEDED} GB of RAM, but the biggest rooted ` +
        `server is ${target} (${ns.getServerMaxRam(target)} GB).`,
    );
    ns.tprint("Root a bigger server, then run install.js again.");
    return;
  }

  // 3. Start the runner, forwarding every flag contractRunner understands.
  const runnerArgs = forwarded(args);
  const pid = ns.exec("contractRunner.ts", target, 1, ...runnerArgs);

  if (pid === 0) {
    ns.tprint(`Could not start contractRunner.ts on ${target} (root access required there).`);
  } else {
    ns.tprint(
      `Started contractRunner.ts on ${target} (pid ${pid}) ` +
        `args: ${runnerArgs.length ? runnerArgs.join(" ") : "(defaults)"}`,
    );
  }
}

/** BFS over ns.scan(); returns the biggest rooted server with >= RAM_NEEDED GB. */
function bestHost(ns, fallback) {
  const seen = new Set();
  const queue = ["home"];
  let best = null;
  let bestRam = 0;

  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  for (const host of seen) {
    const server = ns.getServer(host);
    if (server.hasAdminRights && server.maxRam >= RAM_NEEDED && server.maxRam > bestRam) {
      best = host;
      bestRam = server.maxRam;
    }
  }

  return best ?? fallback;
}

/** Strip installer-only flags, keep everything contractRunner.ts understands. */
function forwarded(args) {
  const out = [];
  for (let i = 0; i < args.length; ++i) {
    const a = args[i];
    if (a === "--ref" || a === "--server") {
      i += 1; // skip its value
      continue;
    }
    if (a === "--no-run") continue;
    out.push(a);
  }
  return out;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
```

</details>

---

## Requirements

| Requirement | Why |
|---|---|
| **28 GB RAM** on the server running `contractRunner.ts` | `attempt` 10 GB + `getContractType` 5 GB + `getData` 5 GB + `getNumTriesRemaining` 2 GB + base 1.6 GB ≈ 27.4 GB. `contracts.ts` is loaded with `ns.dynamicImport()`, which costs **0 GB**. |
| **Root access** on the server *running* the script | Needed for `exec`/`scp`. Not needed for the contract API itself. |
| Nothing else | Coding contracts can be solved on servers you **cannot** hack. |

If you don't have a 28 GB rooted server yet, the installer tells you the biggest
one you do have and stops. Root a bigger server (e.g. with `--open-ports` on
servers you already can root) and run it again.

## Manual install (no network)

If `wget` is blocked or you prefer to paste the files yourself:

1. `nano contractRunner.ts` → paste
   [scripts/contractRunner.ts](scripts/contractRunner.ts), save.
2. `nano contracts.ts` → paste
   [scripts/contracts.ts](scripts/contracts.ts), save.
3. `run contractRunner.ts`

Both files must be on the **same server** — the runner checks for `contracts.ts`
next to it before starting.

## What the runner actually does

1. **BFS from `home`** over `ns.scan()` to discover every reachable server.
2. `ns.ls(host, ".cct")` on each server to list the contracts.
3. Skips contract types it has no solver for (printed at the start of the run).
4. Solves with the matching function in `contracts.ts`, which mirrors the
   official `src/codingContracts/ContractTypes.ts` implementations.
5. Submits with `ns.codingcontract.attempt(answer, file, host)`.
6. With `--open-ports`, it opens every port it has the program for and NUKEs the
   server — already-open ports count toward `numOpenPortsRequired`.

## Testing locally

```bash
npm install          # only needs typescript
npm run selftest     # 36 known-answer checks against the real game solvers
npm run fuzz         # 8400 randomized checks vs. reference implementations
npm run mock         # end-to-end run of contractRunner.ts against a fake ns API
npm run mock-install # same, but through install.js (wget/exec/scp mocked)
```

Useful mock scenarios:

```bash
LOW_RAM=1 node mockrun.mjs --install      # home has 8 GB -> relocates to n0006
NO_BIG=1 LOW_RAM=1 node mockrun.mjs --install   # no big rooted server -> warns
```

## Project layout

| File | Purpose |
|---|---|
| `scripts/install.js` | In-game bootstrap: downloads everything from GitHub and starts the runner |
| `scripts/contractRunner.ts` | Network scan, contract discovery, submission, optional port opening |
| `scripts/contracts.ts` | All solvers + `selfTest()` + `CONTRACT_TYPES` |
| `mockrun.mjs` | Fake `ns` API for end-to-end testing without the game |
| `selftest.mjs` | Known-answer tests |
| `fuzz.mjs` | Randomized differential tests |
| `c_*.ts` | Reference copies of the official game contract implementations |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FAILED to download ...` | Check the branch with `--ref main`. `raw.githubusercontent.com` allows CORS, so `wget` works; a proxy/firewall may not. |
| `Not enough RAM` | Run on a server with ≥ 28 GB. The installer picks the biggest rooted one automatically. |
| `Could not start contractRunner.ts` | `exec` requires root on that server. Root it first, or run the installer on a server you already have root on. |
| `0 solved`, contracts skipped | The contract type has no solver yet — the runner prints `No solver for: ...` at the start. |
| Contract attempts exhausted | The runner skips contracts with `tries <= 0`. Use `--dry-run` first to verify answers before spending attempts. |
| Want to stop the loop | `kill contractRunner.ts` in the terminal. |


---
