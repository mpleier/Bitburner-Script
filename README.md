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
| `autobot.ts` | 12 GB | — | Orchestrator: installs, plans, places, starts, monitors |
| `core.ts` | 0 GB* | — | Shared helpers (BFS scan, rooting, formatting) loaded via `dynamicImport` |
| `types.ts` | 0 GB* | — | Shared type definitions |
| `hacking.ts` | 28 GB | — | Buys programs, roots servers, leaves backdoors, weaken → grow → hack, upgrades home RAM |
| `hacknet.ts` | 8 GB | SF6 | Buys/upgrades nodes, spends hash on the best thing |
| `contractRunner.ts` | 28 GB | — | Finds every `*.cct` on the network and solves it with 24 built-in solvers |
| `contracts.ts` | 0 GB* | — | The solvers themselves |
| `factions.ts` | 34 GB | — | Work for factions, donate, buy augmentations |
| `jobs.ts` | 10 GB | — | Applies for the highest-paying job across all 25 companies |
| `crime.ts` | 38 GB | — | Picks the best crime by expected money/sec, shadow-chains faction reps |
| `gang.ts` | 28 GB | SF3 | Recruits, assigns optimal tasks, buys weapons, ascends |
| `bladeburner.ts` | 92 GB | SF4 / BN4 | City selection, contracts/ops, skill-point spending |
| `corporation.ts` | 421 GB | SF12 | Self-managing corporation: divisions, offices, hires, materials, research |
| `stock.ts` | 36 GB | SF8 | Tick-based trading with position sizing |
| `stanek.ts` | 17 GB | SF11 | Greedy fragment packing with rotation, charges everything |
| `sleeves.ts` | 45 GB | SF10 | Shock recovery → sync → stat-matched task per sleeve |
| `go.ts` | 50 GB | SF14 | Plays Go using atari/liberty analysis, collects rewards |
| `infiltration.ts` | 18 GB | SF13 | Ranks SP500 locations by expected value, infiltrates the best |
| `darknet.ts` | 26 GB | BN10 | Harvests stasis links, probes neighbours, heartbleeds logs |
| `share.ts` | 4 GB | — | Fills leftover RAM with `share()` for faction work |

\* `core.ts`, `types.ts` and `contracts.ts` are loaded with `ns.dynamicImport()`, which has a
**RAM cost of 0 GB**. They still have to be present on the same server as the module that
imports them — `autobot.ts` copies them there automatically.

Total RAM if every module ran at once: **~895 GB**. In practice the orchestrator only starts
the subsystems that are actually unlocked, and it refuses to start anything that would
over-commit a server.

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

`corporation.ts` is the outlier at **421 GB** because the Corporation API has ~100
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
npm install                 # only needs typescript
npm run typecheck           # tsc --noEmit over every module
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
tsconfig.json         strict TS config (noEmit)
defs.d.ts             the game's own API typings
RamCostGenerator.ts   the game's RAM cost table
c_*.ts                reference copies of official contract implementations
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `FAILED to download ...` | Check the branch with `--ref main`. `raw.githubusercontent.com` allows CORS, so `wget` works; a proxy/firewall may not. |
| `autobot.ts needs ~12 GB` | Run it on a server with at least 12 GB, or use `--only hacknet,share` until you have one. |
| `Not enough RAM` in a module | That module's header lists the exact requirement. Root a bigger server or upgrade home RAM. |
| `Could not start autobot.ts` | `exec` requires root on the target server. Root it first, or run the installer somewhere you already have root. |
| A module shows as `blocked` | The dashboard prints why (missing Source-File, Bitnode requirement, not enough RAM). It is not a bug. |
| `0 solved`, contracts skipped | That contract type has no solver yet — the runner prints `No solver for: ...` at the start. |
| Contract attempts exhausted | Use `--dry-run` first to verify answers before spending attempts. |
| Want to stop everything | `run autobot.ts --kill` |

