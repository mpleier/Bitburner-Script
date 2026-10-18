# Bitburner Automation Suite

A modular, self-installing automation suite for [Bitburner](https://bitburner-official.github.io/).
One orchestrator (`autobot.ts`) decides what is unlocked in your current Bitnode, places each
subsystem on the biggest rooted server that can hold it, and keeps them all running.

```text
run install.js
```

That single command downloads 20 files from GitHub, picks the best server, and starts the bot.

---

## What is in the suite

| Module | RAM | Requires | What it does |
|---|---:|---|---|
| `autobot.ts` | 8 GB | — | Orchestrator: installs, plans, places, starts, monitors |
| `core.ts` | 4.8 GB* | — | Shared helpers (BFS scan, rooting, formatting), statically imported by every module |
| `types.ts` | 0 GB | — | Shared type definitions (type-only import, erased by the transpiler) |
| `hacking.ts` | 39 GB | — | Buys programs, roots servers, leaves backdoors, weaken → grow → hack, upgrades home RAM |
| `hacknet.ts` | 15 GB | SF6 | Buys/upgrades nodes, spends hash on the best thing |
| `contractRunner.ts` | 29 GB | — | Finds every `*.cct` on the network and solves it with 24 built-in solvers |
| `contracts.ts` | 0 GB* | — | The solvers themselves (they make no API calls, so `dynamicImport` is safe) |
| `factions.ts` | 54 GB | — | Work for factions, donate, buy augmentations |
| `jobs.ts` | 18 GB | — | Applies for the highest-paying job across all 25 companies |
| `crime.ts` | 42 GB | — | Picks the best crime by expected money/sec, shadow-chains faction reps |
| `gang.ts` | 39 GB | SF3 | Recruits, assigns optimal tasks, buys weapons, ascends |
| `bladeburner.ts` | 72 GB | SF4 / BN4 | City selection, contracts/ops, skill-point spending |
| `corporation.ts` | 455 GB | SF12 | Self-managing corporation: divisions, offices, hires, materials, research |
| `stock.ts` | 39 GB | SF8 | Tick-based trading with position sizing |
| `stanek.ts` | 19 GB | SF11 | Greedy fragment packing with rotation, charges everything |
| `sleeves.ts` | 41 GB | SF10 | Shock recovery → sync → stat-matched task per sleeve |
| `go.ts` | 53 GB | SF14 | Plays Go using atari/liberty analysis, collects rewards |
| `infiltration.ts` | 20 GB | SF13 | Ranks SP500 locations by expected value, infiltrates the best |
| `darknet.ts` | 20 GB | BN10 | Harvests stasis links, probes neighbours, heartbleeds logs |
| `share.ts` | 4 GB | — | Fills leftover RAM with `share()` for faction work |

\* `core.ts` is **statically** imported, so its API calls are added to every module that
imports it. `contracts.ts` is the only `ns.dynamicImport()` in the suite, and that is safe
only because it makes no API calls at all. Every module needs `core.ts`, `types.ts` and
`contracts.ts` on the same server — `autobot.ts` `scp`s them there automatically.

Total RAM if every module ran at once: **~959 GB** (with Source-File 4 installed). Without
SF4 the Singularity API costs 16× more, so the Singularity-heavy modules need far more RAM
than the table shows. In practice the orchestrator only starts the subsystems that are
actually unlocked, and it refuses to start anything that would over-commit a server.

---

## Typing `ns`: why there is no `import { NS }` anywhere

Bitburner ships its own API typings and the script editor injects them as a **global**
declaration file (it strips every `export` keyword before handing them to Monaco). So in
the game this is all you need:

```ts
export async function main(ns: NS) { /* ... */ }
```

Writing `import type { NS } from "../defs.d";` is the classic way to get "red squiggles"
fixed in a local editor, but in the game it is a trap:

* `defs.d.ts` is **not a script file** — the module resolver only accepts `.js`, `.jsx`,
  `.ts`, `.tsx` and `.script`, and it refuses any path that escapes the script root.
* `../defs.d` from `scripts/autobot.ts` resolves to `/defs.d.js`, which does not exist in
  the game, so the script dies with **`Module not found: ../defs.d`** before `main()` is
  ever called.

Every module in this suite therefore relies on the global `NS` type. For local
`npm run typecheck`, `globals.d.ts` mirrors the game's behaviour by re-exporting the
typings as globals. `npm run imports` replays the game's transpile + module-resolution
pipeline locally so a bad import is caught before it reaches the game.

---

## Quick start

### 1. Create the installer (one time)

In the in-game terminal:

```text
nano install.js
```

Paste the contents of [scripts/install.js](scripts/install.js), save with **Ctrl+S**, then:

```text
run install.js
```

`ns.wget()` (0 GB RAM) pulls every file straight from GitHub, so you never have to paste
the solver code into the game. Re-running `install.js` is also how you **update** the suite.

### 2. Watch it

```text
tail autobot.ts
```

Typical output:

```text
=== autobot dashboard ===
running 6 modules | blocked 10
  hacking.ts         -> n0006      28 GB  root servers, backdoors, weaken/grow/hack, home RAM
  hacknet.ts         -> home       8 GB   buy/upgrade hacknet nodes, spend hash
  contractRunner.ts  -> n0003      28 GB  find and solve every coding contract
  jobs.ts            -> n0001      10 GB  apply for the best-paying job
  share.ts           -> n0002      4 GB   fill leftover RAM with share() for faction work
network RAM: 62.4 / 128.0 GB on 9 rooted servers
blocked: gang (needs Source-File 3), bladeburner (not in this Bitnode), ...
```

### 3. Stop it

```text
run autobot.ts --kill
```

---

## Orchestrator flags

| Flag | Effect |
|---|---|
| `--install` | `wget` every suite file from GitHub onto the current server first |
| `--dry-run` | Plan and print, but never `exec` anything |
| `--loops N` | Run N planning passes then exit (useful for testing) |
| `--interval 5000` | Re-plan every N ms (default 5000) |
| `--only hacking,hacknet` | Run only these modules |
| `--skip corporation,go` | Exclude these modules |
| `--status` | Print the dashboard once and exit |
| `--kill` | Kill every module the suite started, then exit |
| `--ref main` | Which branch/tag to download from |

`install.js` accepts the same flags plus `--open-ports` (root everything you can),
`--no-run` (install only) and `--server n0006` (force where the bot runs).

---

## How the orchestrator places modules

1. **BFS from `home`** over `ns.scan()` to discover the whole network.
2. `core.subsystemAvailable()` filters out subsystems you cannot use yet
   (missing Source-File, wrong Bitnode, Bladeburner disabled, etc.).
3. Modules are sorted by **priority** (1 = most important). Each one claims the rooted
   server with the most *free* RAM that can still hold it.
4. `core.ts` / `types.ts` / `contracts.ts` are `scp`'d alongside each module.
5. Anything that does not fit anywhere is reported as `blocked` in the dashboard, with
   the reason.

Priority 1 is `hacking.ts`, so the biggest servers go to the module that actually grows
your RAM over time.

---

## Per-module flags

Every module can be run standalone. All of them accept `--dry-run` and `--loops N`.

| Module | Extra flags |
|---|---|
| `hacking.ts` | `--interval 2000` |
| `hacknet.ts` | `--interval 2000`, `--max-nodes 200`, `--no-hashes` |
| `contractRunner.ts` | `--loop`, `--interval 30000`, `--max 50`, `--host CSEC`, `--open-ports`, `--selftest` |
| `factions.ts` | `--interval 2000`, `--install-augs` |
| `jobs.ts` | `--companies ECorp,Phantasm` |
| `crime.ts` | `--focus Robbery` |
| `gang.ts` | `--interval 2000`, `--ascend-at 100000` |
| `corporation.ts` | `--divisions Software,Robotics` |
| `stock.ts` | `--risk 0.5` |
| `stanek.ts` | `--charge-every 5000` |
| `sleeves.ts` | `--sync-target 100` |
| `infiltration.ts` | `--top 5`, `--rep-only` |
| `darknet.ts` | `--max-attempts 5` |

Example — solve contracts only, on a specific server:

```text
run contractRunner.ts --host n0006 --loop --interval 60000
```

---

## Coding contracts

24 contract types have solvers, mirroring the official
`src/codingContracts/ContractTypes.ts` implementations. Root access is **not** required:
the Coding Contract API works on any server your script can `scan`, so contracts on
servers you cannot hack are still solved.

Contract types with no solver are skipped and printed at the start of the run.

If you do want those servers rooted for hacking, pass `--open-ports`: the runner opens
every port you have a program for and NUKEs the server. Already-open ports count toward
`numOpenPortsRequired`.


---

## RAM: what actually costs what

Bitburner **reserves** RAM statically and **charges** it dynamically:

* `src/Script/RamCalculations.ts` walks the AST of the script **and of every script it
  statically imports**, and sums the cost of every distinct `ns.*` function it can see on
  top of the 1.6 GB base cost. That sum is the allocation the script gets.
* `src/Netscript/APIWrapper.ts` then charges each function the **first time it is actually
  called**. Calling `ns.scan()` a thousand times costs 0.2 GB, not 200 GB.

Two consequences worth knowing:

1. A function is paid for as soon as it appears anywhere in the file, even in a branch
   that never runs.
2. **`ns.dynamicImport()` is invisible to the static pass.** The API calls made inside a
   dynamically imported module are still charged, but nothing reserved them, and the game
   aborts the script with
   `Dynamic RAM usage calculated to be greater than RAM allocation.`
   That is exactly why every module here uses
   `import * as core from "./core.ts";` instead of `await ns.dynamicImport("./core.ts")`.

`node ramgap.mjs` replays both passes locally and fails if any script's dynamic charge can
ever exceed its allocation.

RAM costs come straight from the game's
[RamCostGenerator.ts](RamCostGenerator.ts), and every module header lists its own
breakdown. The big ones:

| API | RAM |
|---|---:|
| `ns.dynamicImport()` | 0 GB |
| `ns.wget()` | 0 GB |
| `ns.print()` / `ns.tprint()` / `ns.sleep()` | 0 GB |
| `ns.scan()` | 0.2 GB |
| `ns.ls()` | 0.2 GB |
| `ns.getServer()` | 2 GB |
| `ns.getServerMaxRam()` | 0.05 GB |
| `ns.exec()` | 1.3 GB |
| `ns.scp()` | 0.6 GB |
| `ns.codingcontract.attempt()` | 1 GB |
| `ns.codingcontract.getContractType()` | 1 GB |
| `ns.codingcontract.getData()` | 5 GB |
| `ns.codingcontract.getNumTriesRemaining()` | 2 GB |
| `ns.corporation.*` | 4 GB per call |
| `ns.bladeburner.*` | 4 GB per call |
| `ns.gang.*` | 2 GB per call |

`corporation.ts` is the outlier at **455 GB** because the Corporation API has ~100
functions and each one is charged separately. It will only start once you have a server
with that much RAM (a fully upgraded home, or a big server like `n0001` after
`--open-ports` and RAM upgrades). The module prints a clear message and exits instead of
crashing.

Every module checks `ns.getServerMaxRam(host)` at entry and prints a readable error if the
server is too small, so nothing fails silently.

---

## Testing without the game

The repo ships a fake `ns` API so the whole suite can be exercised offline:

```bash
npm install                 # typescript + the transpiler used by the import check
npm run typecheck           # tsc --noEmit over every module
npm run imports             # replay the game's module resolver on every script
npm run selftest            # 36 known-answer contract checks
npm run fuzz                # 8400 randomized differential checks
npm run mock              # every module against a fake ns API
npm run suite             # same, 3 loops, verbose output
npm run test              # all of the above
```

`mocksuite.mjs` builds a realistic network (home + 20 servers, ports, programs, gang,
Bladeburner, corporation, Stanek, Go, Darknet, sleeves, 24 contract types) and calls
`main(ns)` on each module. It has a loop budget so scripts like `share.ts` that run
forever terminate instead of hanging.

```bash
node mocksuite.mjs                          # all modules
node mocksuite.mjs stanek go --verbose      # just two, with log output
node mocksuite.mjs --loops 5 --bitnode 10   # BN10: darknet becomes available
node mocksuite.mjs --ram 1024               # pretend home has 1 TB
node mocksuite.mjs --no-sf                  # no Source-Files: most modules skip
node mocksuite.mjs --money 100              # broke player: corp/stock bail out
```

A module is reported as `[ok]`, `[ok (loop budget reached)]` or `[FAIL: ...]`.

---

## Project layout

```text
scripts/
  autobot.ts          orchestrator
  install.js          in-game bootstrap (the only file you paste manually)
  core.ts             shared helpers
  types.ts            shared types
  contracts.ts        24 contract solvers
  contractRunner.ts   contract discovery + submission
  hacking.ts hacknet.ts factions.ts jobs.ts crime.ts gang.ts
  bladeburner.ts corporation.ts stock.ts stanek.ts sleeves.ts
  go.ts infiltration.ts darknet.ts share.ts

mocksuite.mjs         fake ns API, runs the whole suite offline
selftest.mjs          known-answer solver tests
fuzz.mjs              randomized differential tests
importcheck.mjs       replays the game's module resolver to catch bad imports
ramgap.mjs            static allocation vs. dynamic charge, per script
ramcheck.mjs          per-module RAM budget audit
ramtable.json         the RAM cost table extracted from RamCostGenerator.ts
tsconfig.json         strict TS config (noEmit)
globals.d.ts          makes NS global for local tsc, like the game's editor does
defs.d.ts             the game's own API typings
RamCostGenerator.ts   the game's RAM cost table
c_*.ts                reference copies of official contract implementations
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Module not found: ../defs.d` | Do not import the typings. `NS` is a global type in Bitburner; see [Typing `ns`](#typing-ns-why-there-is-no-import--ns-anywhere). |
| `FAILED to download ...` | Check the branch with `--ref main`. `raw.githubusercontent.com` allows CORS, so `wget` works; a proxy/firewall may not. |
| `autobot.ts needs ~8 GB` | Run it on a server with at least 8 GB, or use `--only hacknet,share` until you have one. |
| `Dynamic RAM usage calculated to be greater than RAM allocation` | The script's declared budget is below what Bitburner actually allocates. Run `node ramgap.mjs` to see the real allocation of every module, then raise that module's `RAM_NEEDED`. This is also what happens if a module that calls the API is loaded through `ns.dynamicImport()`. |
| `Not enough RAM` in a module | That module's header lists the exact requirement. Root a bigger server or upgrade home RAM. |
| `Could not start autobot.ts` | `exec` requires root on the target server. Root it first, or run the installer somewhere you already have root. |
| A module shows as `blocked` | The dashboard prints why (missing Source-File, Bitnode requirement, not enough RAM). It is not a bug. |
| `0 solved`, contracts skipped | That contract type has no solver yet — the runner prints `No solver for: ...` at the start. |
| Contract attempts exhausted | Use `--dry-run` first to verify answers before spending attempts. |
| Want to stop everything | `run autobot.ts --kill` |

