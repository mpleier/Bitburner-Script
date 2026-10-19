# Bitburner Automation Suite

A modular, self-installing automation suite for [Bitburner](https://bitburner-official.github.io/).
One orchestrator (`autobot.ts`) decides what is unlocked in your current Bitnode, places each
subsystem on the biggest rooted server that can hold it, and keeps them all running.

```text
run install.js
```

That single command downloads 23 files from GitHub, picks the best server, and starts the bot.

---

## What is in the suite

| Module | RAM | Requires | What it does |
|---|---:|---|---|
| `autobot.ts` | 17 GB | — | Orchestrator: installs, plans, places, starts, monitors |
| `core.ts` | 11.9 GB* | — | Shared helpers (BFS scan, rooting, formatting, Bladeburner/work conflict guards), statically imported by every module |
| `logger.ts` | 0.05 GB* | — | Routes every module's output into a log file instead of the terminal |
| `types.ts` | 0 GB | — | Shared type definitions (type-only import, erased by the transpiler) |
| `state.ts` | 2.2 GB* | — | The shared ledger: which server has which module, who holds a work slot, what each module is waiting for |
| `hacking.ts` | 36 GB | — | Buys programs on the darkweb, roots servers, leaves backdoors, weaken → grow → hack, upgrades home RAM |
| `hacknet.ts` | 24 GB | — | Buys/upgrades nodes, spends hash on the best thing |
| `contractRunner.ts` | 29 GB | — | Finds every `*.cct` on the network and solves it with 24 built-in solvers |
| `contracts.ts` | 0 GB* | — | The solvers themselves (they make no API calls, so `dynamicImport` is safe) |
| `factions.ts` | 55 GB | — | Work for factions, donate, buy augmentations |
| `jobs.ts` | 24 GB | — | Applies for the highest-paying job across all 25 companies |
| `crime.ts` | 43 GB | — | Picks the best crime by expected money/sec, shadow-chains faction reps |
| `gang.ts` | 46 GB | BN2 / SF2 | Recruits, assigns optimal tasks, buys weapons, ascends |
| `bladeburner.ts` | 78 GB | BN6-7 / SF6 | City selection, contracts/ops, skill-point spending |
| `corporation.ts` | 462 GB | BN3 / SF3 | Self-managing corporation: divisions, offices, hires, materials, research |
| `stock.ts` | 46 GB | BN8 / SF8 | Tick-based trading with position sizing |
| `stanek.ts` | 26 GB | BN13 / SF13 | Greedy fragment packing with rotation, charges everything |
| `sleeves.ts` | 48 GB | BN10 / SF10 | Shock recovery → sync → stat-matched task per sleeve |
| `go.ts` | 60 GB | BN14 / SF14 | Plays Go using atari/liberty analysis, collects rewards |
| `infiltration.ts` | 27 GB | — | Ranks SP500 locations by expected value, infiltrates the best |
| `darknet.ts` | 27 GB | BN15 / SF15 | Harvests stasis links, probes neighbours, heartbleeds logs |
| `share.ts` | 6 GB | — | Fills leftover RAM with `share()` for faction work |
| `ascend.ts` | 17 GB | — | The endgame: install everything, then reset for the source files. **Off by default** — enable with `--ascend` |
| `casino.ts` | 35 GB | — | Blackjack at the Iker Molina Casino through the browser UI; on by default, disable with `--no-casino`, and it stops for good once the house kicks us out |
| `casino-policy.ts` | 1.6 GB | — | The casino's decision tables (wager sizing, blackjack strategy, reload logic) - no API calls, so it is unit-testable offline |
| `focus-policy.ts` | 1.6 GB | — | Who gets the one `Player.currentWork` slot, and who gets to use the browser UI |
| `spending-policy.ts` | 1.6 GB | — | How much of the bankroll each subsystem is allowed to touch |
| `bitnode-policy.ts` | 1.6 GB | — | Which BitNode to replay next, ranked by the source files it unlocks |

\* `core.ts`, `state.ts` and the four policy modules are **statically** imported, so their
API calls are added to every module that imports them. The policy modules make no API
calls at all, so importing one costs only the 1.6 GB base script cost. `contracts.ts` is
the only `ns.dynamicImport()` in the suite, and that is safe only because it makes no API
calls at all. Every module needs `core.ts`, `types.ts` and `contracts.ts` on the same
server — `autobot.ts` `scp`s them there automatically.

Total declared budget if every module ran at once: **~1,127 GB** (the game actually charges
~1,111 GB of that; the difference is the headroom each module keeps so it can never be
"Dynamic RAM usage calculated to be greater than RAM allocation" - see `npm run ram`). With
Source-File 4 installed the Singularity API costs 16× less, so the Singularity-heavy modules
need far less RAM than the table shows. In practice the orchestrator only starts the
subsystems that are actually unlocked, and it refuses to start anything that would
over-commit a server.

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

`install.js` updates **itself**: it is the one file the game cannot refresh by itself, so
every run it downloads its own newest version from GitHub and, if the file changed, starts
the fresh copy and lets that finish the install. One paste is all you ever need.

```text
run install.js              # refreshes install.js, then installs everything
run install.js --no-update  # skip the self-refresh (offline, or a hand-edited copy)
```

If the download fails (no internet, GitHub blocked) the installer just carries on with the
copy already on the server, and you can still refresh it by hand:

```text
wget https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/install.js install.js
run install.js
```

### 2. Watch it

Every module writes to `autobot_log.txt` on the server it runs on, so the log is where the
action is. Each rooted server keeps its own copy, so read the log of the server you want:

```text
connect n0006          # or: cd n0006
cat autobot_log.txt
run install.js --logs 30      # last 30 log lines; install.js searches every rooted
                              # server and prints which one the log came from
                              # (ns.read() only sees the server the script runs on, so
                              # a log living elsewhere is scp()'d over first)
run install.js --status       # which suite scripts are running, where, and their RAM
run autobot.ts --verbose      # mirror the log to the terminal as it happens
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
run install.js --kill     # kills every suite script on every rooted server
run autobot.ts --kill     # same, but autobot.ts itself needs 16 GB of RAM
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
| `--no-casino` | Turn `casino.ts` off. It runs by default, and while it runs the orchestrator mutes `crime.ts`, `jobs.ts`, `factions.ts`, `bladeburner.ts` and `share.ts` |
| `--ascend` | Turn `ascend.ts` on. It is **off by default**: the module installs every augmentation you can afford and then resets the run to collect source files. Only flip it once you are confident the rest of the suite is carrying you |
| `--status` | Print the dashboard once and exit |
| `--no-cooldown` | Restart a module on every interval even if it keeps exiting straight away |
| `--kill` | Kill every module the suite started, then exit |
| `--logs 50` | Dump the last 50 lines of the log file to the terminal and exit |
| `--log mybot.txt` | Write the log to a different file |
| `--ref main` | Which branch/tag to download from |

`install.js` accepts the same flags plus `--open-ports` (root everything you can),
`--no-run` (install only), `--server n0006` (force where the bot runs), `--selftest`
(one dry-run pass of the orchestrator), `--no-update` (do not refresh install.js itself),
`--kill` (stop the whole suite from a small
server - `install.js` only needs ~7 GB, `autobot.ts` needs 16 GB), `--logs N` (read
the log without running anything) and `--status` (which suite scripts are running, on
which server, how much RAM each costs, and where the log file is).

---

## Logging: output goes to a file, not the terminal

Every module writes to `autobot_log.txt` on the server it is running on instead of
printing to the terminal. `logger.ts` is the only file that touches it, and
`ns.write()` / `ns.read()` cost 0 GB each (RamCostGenerator.ts), so logging is free.

```text
cat autobot_log.txt            # in the game terminal, on the server you are connected to
run autobot.ts --logs 50       # dump the last 50 log lines from the terminal
```

Rules the logger follows:

- **The file is per server.** `ns.write()` always targets the server the script is
  running on (`ctx.workerScript.getServer()`), so a module running on `n0006` writes
  `n0006`'s copy of the log. Connect to that server to read it.
- **Only `.txt`, `.json` and `.css` are valid paths.** `ns.write()` rejects anything
  else, so `autobot.log` throws "File path should be a text file or script."
  `--log mylog` is silently turned into `mylog.txt`.
- **The log is capped at 60 KB.** Once it grows past that the oldest lines are
  dropped, so a bot that runs for months cannot fill up your file list.
- **`--verbose` (or `--print`) mirrors the log to the terminal** as it is written.
- **`--no-log`** keeps the old behaviour: print to the terminal, write nothing.
- **Busy modules summarise.** `gang.ts`, `corporation.ts` and `casino.ts` write one
  line per cycle ("members 6 | respect 1200.0 | ... | this cycle: 6 recruits,
  6 purchases (8.40K)") instead of one line per member, office, hire or hand. Pass
  `--verbose` to get every individual action.
- **`contractRunner.ts` never prints to the terminal.** Every contract it touches and
  one summary line per round ("Round 3: 12 contracts | 11 solved | 1 failed") go to the
  log file; add `--verbose` to see them as they happen.
- **Milestones and fatal errors still `tprint`.** `logger.tlog()` writes to the file
  *and* to the console, so "not enough RAM" / "corporation disabled" is never missed.
  `logger.tlogOnce()` is the same but only reaches the console the first time the
  message appears - useful for "not ready yet" lines, since `autobot.ts` restarts a
  module every interval and would otherwise print them forever.
  `install.js` is deliberately terminal-only - it is the bootstrap you type by hand.
- **Logging can never crash a module.** If the write throws, the line falls back to
  `ns.print()`.

Every line looks like:

```text
[2026-10-18 14:03:07] home bought BruteSSH.exe for 1.00M
```

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

## The three policies

Everything that used to be a hardcoded rule inside `autobot.ts` now lives in a small
module with no API calls, so it can be unit-tested offline and changed without touching
the orchestrator.

### `focus-policy.ts` — who gets to work

`Player.currentWork` is a single slot. Only one activity can occupy it, and the game
refuses to queue things you are not allowed to do (a job you never applied for, a faction
you never joined, Bladeburner in a BitNode without SF6). The policy answers three
questions:

1. **Do these two activities fight?** `conflictsWith(a, b)` returns true for any pair of
   work-slot activities (there is only one slot) and for a UI driver paired with any work
   activity (the work page replaces the browser page). `blockedBy(activity)` lists
   everything `activity` pushes out.
2. **Who wins the slot?** `prioritizeActivities()` puts the UI drivers first. The casino
   needs the browser, and the browser is not a work slot — so a casino run does not
   compete with crime or a job for the slot, but a *muted* module must not be started at
   all. `allowedActivities(candidates)` then resolves the full set, dropping anything
   that collides with an activity already claimed.
3. **Does this module need the player at all?** `focusNeeds(activity)` is true only for
   the work-slot and UI activities; `gang.ts`, `sleeves.ts`, `go.ts` and the rest are
   never muted. `focusReason()` produces the sentence the dashboard prints.

`autobot.ts` publishes the resolved focus into `state.ts` every interval via
`publishFocus()`, so every other module can read what the player is currently doing
instead of guessing.

### `spending-policy.ts` — who gets the money

Hacknet, the aug shop, gang equipment and a corporation all draw from the same bankroll,
and each of them used to spend on its own "is it cheap relative to my cash" rule. That
works until four modules decide simultaneously that something is cheap.

`allowance(cash, subsystem)` returns the slice each subsystem may spend this interval:
a 25% reserve is held back first, then the remainder is capped per subsystem — hacknet 20%,
gang 15%, augmentations 50%, corporation 30%, stock 10%, casino 5%, darknet 5%, infiltration
2%, contracts 0%. Those weights deliberately sum to more than 1: they are **ceilings**, not
a partition. No subsystem is allowed to take more than its ceiling, but two subsystems that
both stay under their ceiling can still both spend, which is what you want — a module that
is capped by someone else's budget would stall for reasons it cannot see.

`hacknet.ts`, `factions.ts`, `gang.ts` and `corporation.ts` all track `spent` locally and
stop when their budget is exhausted — locally, because `ns.getPlayer().money` does not move
in `--dry-run`, so a budget that relied on the game updating it would be wrong exactly when
you most want to test.

### `bitnode-policy.ts` — which BitNode to replay

`nextBitnode(owned, goal)` filters to the BitNodes whose source file you do not own yet,
scores them (+10 if the node serves the goal you asked for, +4 if it unlocks anything the
suite can use, minus difficulty, minus a small tie-breaker on the node number) and returns
the best one. `shouldAscend(readyCount, threshold)` is the "is this batch of augmentations
big enough to justify a reset" test, and `ascendThreshold(owned)` makes that threshold
smaller early in a run, when one augmentation is worth more. Both the dashboard in
`autobot.ts` and `ascend.ts` itself use these.

---

## `ascend.ts`: the endgame, off by default

`ascend.ts` is the only module in the suite that can *end a run*. It watches the augmentation
queue, and once enough augmentations are sitting in it to justify a reset, it calls
`installAugmentations("autobot.ts")` - which soft-resets the BitNode and hands you the source
files. Because a reset throws away servers, programs and money, the module is **not started
unless you pass `--ascend`**; without that flag it runs harmlessly and just reports what it
would do.

Before installing it checks two things: that no Bladeburner action is mid-flight (a reset
cancels it), and that it holds the `ascend_lock` in `state.ts` so two scripts can never
trigger a reset in the same tick.

```text
run autobot.ts --ascend              # arm it through the orchestrator
run ascend.ts --dry-run              # inspect what it would do, standalone
run ascend.ts --ascend --batch 8    # arm it, require 8 queued augs before resetting
```

Its RAM cost is 17 GB, which `npm run ram` confirms against the real API table (16.95 GB
allocated, 17 GB declared).

---

## Per-module flags

Every module can be run standalone. All of them accept `--dry-run`, `--loops N`,
`--log <file>`, `--no-log` and `--verbose`.

| Module | Extra flags |
|---|---|
| `hacking.ts` | `--interval 2000`, `--no-backdoor`, `--backdoor-daemon` |
| `hacknet.ts` | `--interval 2000`, `--max-nodes 200`, `--no-hashes` |
| `contractRunner.ts` | `--loop`, `--interval 30000`, `--max 50`, `--host CSEC`, `--open-ports`, `--selftest` |
| `factions.ts` | `--interval 2000`, `--install-augs` |
| `jobs.ts` | `--companies ECorp,Phantasm` |
| `crime.ts` | `--focus Robbery` |
| `gang.ts` | `--interval 2000`, `--ascend-at 100000` |
| `share.ts` | `--ignore-bladeburner` |
| `corporation.ts` | `--divisions Software,Robotics` |
| `stock.ts` | `--risk 0.5` |
| `stanek.ts` | `--charge-every 5000` |
| `sleeves.ts` | `--sync-target 100` |
| `infiltration.ts` | `--top 5`, `--rep-only` |
| `darknet.ts` | `--max-attempts 5` |
| `casino.ts` | `--max-rounds 1000`, `--simple-strategy`, `--reload-after-losses 10`, `--seed 300000`, `--earn-seed`, `--save-sleep 10`, `--click-sleep 5`, `--find-sleep 0` |
| `ascend.ts` | `--ascend` (arm the reset), `--batch 8` (augmentations needed before a reset is worth it), `--interval 5000` |

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

Because `core.ts` is statically imported, its own API surface is added to *every* module.
`node ramgap.mjs` reports it as **11.3 GB** (1.6 GB base + 9.7 GB of helpers). The Bladeburner
work-conflict guards (`inBladeburner`, `getCurrentAction`, `isBusy`, `getOwnedAugmentations`)
are 6.5 GB of that, which is why every module's `RAM_NEEDED` is 6-7 GB higher than the sum of
its own calls.

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

`corporation.ts` is the outlier at **462 GB** because the Corporation API has ~100
functions and each one is charged separately. It will only start once you have a server
with that much RAM (a fully upgraded home, or a big server like `n0001` after
`--open-ports` and RAM upgrades). The module prints a clear message and exits instead of
crashing.

Every module checks `ns.getServerMaxRam(host)` at entry and prints a readable error if the
server is too small, so nothing fails silently.

---

## Names the game validates: why nothing is hardcoded

Most API calls that take a *name* are checked against an enum at runtime:

```ts
// src/utils/EnumHelper.ts
nsGetMember(ctx, value, argName) {
  if (!this.isMember(value))
    throw `Argument ${argName} should be a ${this.name} enum member. Provided value: "${value}"`;
}
```

The catch is that `ns.enums` only exposes a **subset** of those enums. `CrimeType`,
`FactionName`, `CompanyName`, `LocationName`, `CityName`, `BladeburnerActionType` and a
handful of others are available; `AugmentationName`, `BladeburnerContractName`,
`BladeburnerOperationName`, `IndustryType`, `CorpResearchName` and `GoOpponent` are not.

So a hardcoded augmentation name is a time bomb. This is the crash that killed
`crime.ts`:

```
RUNTIME ERROR
singularity.getAugmentationPrereq: Argument augmentationName should be a AugmentationName enum member.
Provided value: "Shadow Blade".
```

"Shadow Blade", "Shadow Network", "Shadow Qi" ... were the old Shadows of Anarchy
chain. They were replaced by the Infiltration augmentations (`SoA - Might of Ares`,
`SoA - Wisdom of Athena`, ...), so the hardcoded list was stale and the script died
the moment it reached it.

The rule the suite follows: **never hardcode a name the enum cannot be checked
against**. Read it back from the API instead:

```ts
// safe: whatever the game returns is an enum member by construction
for (const aug of ns.singularity.getAugmentationsFromFaction(shadow)) {
  ns.singularity.purchaseAugmentation(shadow, aug);
}
```

`enumcheck.mjs` enforces this offline. It parses every enum out of `defs.d.ts`, walks
the AST of every script, resolves the arguments of the enum-validated calls (literals,
top-level literal arrays, and `for (const x of ARRAY)` loop variables) and fails if any
of them is not a member:

```bash
npm run enums
```

---

## Subsystem access: "Must own a corporation."

Enum validation is not the only runtime guard. Most subsystem APIs also check that the
subsystem actually exists before doing anything, and **throw** if it does not:

```ts
// src/Corporation/ns_Corporation.ts
function checkAccess(ctx, api) {
  if (!Player.corporation) throw helpers.errorMessage(ctx, "Must own a corporation.");
  if (api && !Player.corporation.unlocks.has(api))
    throw helpers.errorMessage(ctx, "You do not have access to this API.");
}
```

`hasCorporation()` and `canCreateCorporation()` are the only two Corporation calls that
do **not** require a corporation. Everything else - `nextUpdate`, `getCorporation`,
`getConstants`, `expandIndustry`, ... - throws when you do not own one.

That is why `corporation.ts` never calls `nextUpdate()` in the "no corporation yet"
branch. Owning Source-File 3 only *permits* creating a corporation; it does not create
one. The loop now reads:

```ts
if (!ns.corporation.hasCorporation()) {
  const check = ns.corporation.canCreateCorporation(true);   // "Success" | reason
  if (check !== "Success") { ns.tprint(check); return; }
  if (core.money(ns) < 150e9) { ns.tprint("A corporation costs $150b"); return; }
  if (dryRun) { ns.print("[dry-run] would create a corporation"); return; }
  if (!ns.corporation.createCorporation("Bitburner Industries", true)) return;
}
// a corporation is guaranteed to exist from here on
await ns.corporation.nextUpdate();
```

`canCreateCorporation()` is a **permission** check, not an affordability check. From
`src/Corporation/helpers.ts`:

```ts
export function canCreateCorporation(selfFund, restart) {
  if (!Player.canAccessCorporation()) return NoSf3OrDisabled;
  if (Player.corporation && !restart) return CorporationExists;
  if (Player.bitNodeN !== 3 && !selfFund) return UseSeedMoneyOutsideBN3;
  if (currentNodeMults.CorporationSoftcap < 0.15) return DisabledBySoftCap;
  return Success;                       // <-- money is never looked at
}

export function costOfCreatingCorporation(restart) {
  if (restart && !Player.corporation?.seedFunded) return 50e9;
  return 150e9;
}
```

So `createCorporation(name, true)` returns `false` with the message *"You don't have
enough money to create a corporation. It costs $150b."* whenever you cannot pay it -
which is why `corporation.ts` checks `core.money(ns) >= 150e9` itself before trying.
Seed money (`createCorporation(name, false)`) is free but only legal in BitNode 3.

The stock market has three stacked gates (`src/StockMarket.ts`):

```ts
// ungated: getConstants, hasWseAccount, hasTixApiAccess, has4SData, has4SDataTixApi
// needs TIX:  getSymbols, getPrice, getPosition, getMaxShares, buyStock, sellStock,
//             buyShort, sellShort, getOrders, getBonusTime, nextUpdate
// needs 4S + TIX: getForecast, getVolatility
```

`stock.ts` therefore buys the WSE account, the TIX API and the 4S Market Data TIX API
*before* it touches the market, and skips the tick when it cannot afford them:

```ts
if (!ns.stock.hasWseAccount()) {
  if (ns.getPlayer().money < COST_WSE) { await ns.sleep(5000); continue; }
  if (!ns.stock.purchaseWseAccount()) { await ns.sleep(5000); continue; }
}
// ... same for TIX, then:
if (!ns.stock.has4SDataTixApi()) {
  if (!ns.stock.purchase4SMarketDataTixApi()) return;   // 4S data disabled in bitnode options
}
const forecast = ns.stock.getForecast(sym);             // safe now
```

The same pattern applies everywhere: check the gate before using the API.

| Subsystem | Gate to check first |
|---|---|
| Corporation | `ns.corporation.hasCorporation()` |
| Gang | `ns.gang.inGang()` |
| Bladeburner | `ns.bladeburner.inBladeburner()` |
| Stock market | `ns.stock.hasWseAccount()`, then `ns.stock.hasTixApiAccess()`, then `ns.stock.has4SDataTixApi()` for `getForecast`/`getVolatility` |
| Sleeves | `ns.sleeve.getNumSleeves() > 0` (needs SF10) |
| Stanek | `ns.stanek.chargeFragment(...)`, gated by SF13 |

`mocksuite.mjs` mirrors these guards, so a module that calls a gated API without the
check fails in the offline test exactly as it does in the game.

---

## Programs: buy them, never create them

`hacking.ts` used to fill in missing programs with `ns.singularity.createProgram()`.
That call does not "make" a program - in `src/Singularity.ts` it is:

```ts
Player.startWork(new CreateProgramWork({ programName, singularity: true }));
if (focus) { Player.startFocusing(); Router.toPage(Page.Work); }
return true;
```

so it takes over the player's work slot and opens the Work page. Every job, faction
shift, crime and `share()` the other modules are running is cancelled, and Bladeburner
automation is switched off. It also needs a hacking level that scales with
Intelligence, and it costs 5 GB of RAM (80 GB without Source-File 4).

Buying is instant and costs money only, so the suite now does this instead:

```ts
if (!core.subsystemAvailable(ns, "singularity")) return;                        // SF4 gate
if (!core.tryCall(() => ns.singularity.purchaseTor(), false)) return;           // 100k router
for (const program of core.DARKWEB_PROGRAMS) {
  const cost = core.tryCall(() => ns.singularity.getDarkwebProgramCost(program), -1);
  if (cost < 0) continue;                        // not sold on the darkweb
  if (cost === 0) continue;                      // already owned
  if (core.money(ns) < cost * 1.2) continue;     // keep a 20% buffer
  core.tryCall(() => ns.singularity.purchaseProgram(program), false);
}
```

Two consequences worth knowing:

* **`NUKE.exe` is not on the darkweb.** It has to be created (hacking level 11) or
  found on a server. `ns.nuke()` returns `false` when we do not have it, so the
  rooting sweep just skips those servers; `hacking.ts` prints one line about it and
  carries on.
* **`getDarkwebProgramCost()` throws** for a program the darkweb does not sell, and
  returns `-1` before TOR is bought. Both paths are wrapped in `core.tryCall`, so a
  locked-out Singularity or an empty bank account is a log line, not a dead script.

---

## Backdoors: `installBackdoor()` has no target argument

`ns.singularity.installBackdoor()` takes **no hostname**. It always backdoors
`Player.getCurrentServer()` - the server the player is *connected to at that
moment*. That single fact is the source of the most common Singularity crash:

```text
RUNTIME ERROR
singularity.installBackdoor: Cannot backdoor daemon server because it is your server
```

`src/Hacking/netscriptCanHack.ts` runs `baseCheck()` before any hack/grow/weaken/
backdoor, and it refuses three kinds of server:

```ts
function baseCheck(server, actionName) {
  if (server.purchasedByPlayer)
    return { res: false, msg: `Cannot ${actionName} ${server.hostname} server because it is your server` };
  if (!server.hasAdminRights)
    return { res: false, msg: `Cannot ${actionName} ${server.hostname} server because you do not have root access` };
  return { res: true };
}
```

So the old `hacking.ts` code

```ts
ns.singularity.connect(host);      // return value ignored
await ns.singularity.installBackdoor();
```

crashed whenever `connect()` failed: the player stayed on their own machine, and
`installBackdoor()` then ran against `home` (or any purchased cloud server), which
is `purchasedByPlayer` and can never be backdoored. The rooted list makes this
worse - it returns *every* server we have root on, which includes home and cloud
servers (hacknet nodes are now filtered out by `core.rootedServers()`, see
[Hacknet nodes are not servers](#hacknet-nodes-are-not-servers)).

`hacking.ts` now checks the gate before touching the API:

```ts
function backdoorBlocker(ns, host, allowDaemon) {
  const server = ns.getServer(host);
  if (!server) return "not reachable from our network";
  if (host === "home") return "home is your own computer";
  if (host === "darkweb") return "the darkweb cannot be backdoored";
  if (host === "daemon" && !allowDaemon) return "World Daemon: ends the bitnode";
  if (server.purchasedByPlayer) return "it is your own server, backdoor is impossible";
  if (server.backdoorInstalled) return "backdoor already installed";
  if (!ns.hasRootAccess(host)) return "no root access";
  if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return "hacking level too low";
  return null;
}
```

and only calls `installBackdoor()` after `connect()` has actually succeeded,
walking one hop through `home` or an already-backdoored server when the target is
not adjacent:

```ts
if (!connectTo(ns, host)) { ns.print(`skipping backdoor on ${host}: not reachable`); continue; }
try { await ns.singularity.installBackdoor(); }
catch (err) { ns.print(`backdoor on ${host} failed: ${err.message}`); }   // never kills the script
```

`scripts/_backdoortest.ts` asserts all of these rules against the mock: owned
server, unrooted server, level too low, the World Daemon, and a non-adjacent
server. Run it with `node mocksuite.mjs _backdoortest --verbose`.

---

## Hacknet nodes are not servers

`ns.scan()` returns hacknet nodes and `ns.hasRootAccess()` says `true` for them,
because we own them. But they are `HacknetServer` objects, not `Server` objects,
so every API that needs real server stats goes through `helpers.getNormalServer()`
(`src/Netscript/Helpers.tsx`), which **throws**:

```ts
// src/Netscript/Helpers.tsx - getNormalServer()
const [server, host] = getServer(ctx, _host);
if (!(server instanceof Server)) {
  let errorMessage = `Cannot be executed on ${host}.`;
  if (server instanceof HacknetServer)
    errorMessage += " The server must not be a hacknet server.";
  throw helpers.errorMessage(ctx, errorMessage);
}
```

That is exactly how `hacking.ts` died once hacknet servers were bought:

```text
RUNTIME ERROR
getServerRequiredHackingLevel: Cannot be executed on hacknet-server-0.
The server must not be a hacknet server.
Stack: hacking.ts:L198@pickTarget
```

The functions that throw on a hacknet node are `getServerRequiredHackingLevel`,
`getServerMaxMoney`, `getServerMoneyAvailable`, `getServerGrowth`,
`getServerSecurityLevel`, `getServerMinSecurityLevel`, `getServerNumPortsRequired`,
`getHackTime`, `getGrowTime`, `getWeakenTime`, `hack`, `grow`, `weaken`, `nuke`
and the five port openers. `getServer`, `getServerMaxRam`, `getServerUsedRam`,
`hasRootAccess` and `ls` are safe - they only need `helpers.getServer()`.

Two helpers now split the difference:

| helper | contains | used for |
|---|---|---|
| `core.rootedServers(ns)` | rooted, **no** hacknet nodes | rooting sweep, backdoors, target selection |
| `core.scriptHosts(ns)` | rooted, hacknet nodes included | script placement - hacknet RAM is real RAM, and RAM used by scripts on a hacknet server raises its hash gain |

`core.isHacknetServer(host)` uses the same hostname prefix test the game itself
uses in `src/Cloud.ts`. `scripts/_hacknettest.ts` asserts the split; run it with
`node mocksuite.mjs _hacknettest --verbose`.

---

## Bladeburner vs. everything that uses `Player.currentWork`

The game cancels a running Bladeburner action the moment the player starts *any*
other work, unless the BladesSimulacrum augmentation is installed:

`Bladeburner.process()` (paraphrased from `src/Bladeburner/Bladeburner.ts`) checks the
player's work slot every tick:

```ts
// Bladeburner.process() - paraphrased
if (Player.currentWork && !Player.hasAugmentation(AugmentationName.BladesSimulacrum, true)) {
  this.cancelAction();          // action reset, automation turned off, dialog shown
}
```

`Player.currentWork` is set by **company work, faction work, crimes, class work
and `ns.share()`**. (`ns.singularity.isBusy()` is slightly broader - it also
reports the Infiltration and BitVerse pages - so using it as the test is
conservative.) So in BitNode 6/7 (or with Source-File 6/7) a Bladeburner
operation and the rest of the suite fight for the same player.

The suite handles it in five places:

| Module | What it does |
|---|---|
| `crime.ts` | skips `commitCrime()` while the player's time is claimed (`core.workBladeburnerConflict()`) |
| `jobs.ts` | skips `workForCompany()` while a Bladeburner action is running |
| `factions.ts` | skips `workForFaction()` while a Bladeburner action is running |
| `bladeburner.ts` | refuses to `startAction()` while the player is already working (`core.wouldCancelBladeburner()`) |
| `share.ts` | idles instead of `share()` while a Bladeburner action is running; pass `--ignore-bladeburner` if you own BladesSimulacrum |

`share.ts` deliberately does **not** import `core.ts`: it is meant to run on
every server with spare RAM, and `core.ts` would add 11.3 GB to it. It probes
`ns.bladeburner.inBladeburner()` (0 GB) and `getCurrentAction()` (1 GB) directly.

`core.ts` exposes the shared predicates:

```ts
core.inBladeburner(ns);              // 0 GB
core.bladeburnerBusy(ns);            // 1 GB
core.hasBladesSimulacrum(ns);        // 5 GB
core.wouldCancelBladeburner(ns);     // + 0.5 GB (singularity.isBusy)
core.workBladeburnerConflict(ns);    // busy either way, no extra RAM
```

Verify the behaviour offline:

```bash
node mocksuite.mjs _bladeburnertest --verbose
node mocksuite.mjs _bladeburnertest --blades-simulacrum --verbose
```

---

## The casino: the only module that touches the browser

Blackjack has no API. The Iker Molina Casino is a React page inside the Overview
panel, so `casino.ts` is the one module in the suite that reaches into the DOM:

```ts
const doc = eval("document");   // Bitburner's sandbox does not expose `document`
const table = doc.evaluate(xpath, doc, null, 9, null).singleNodeValue;
```

Clicking the DOM node is often not enough, because the component's state only
changes through the handler React attached to it, so the script calls that handler
directly and falls back to a plain `click()`:

```ts
const handler = reactHandler(button, "onClick");   // __reactProps$... / __reactFiber$...
if (handler) handler(fakeEvent(button));
else button.click();
```

**Why the logic lives in `casino-policy.ts`.** Bitburner computes a script's RAM
from the API calls it can see in the AST. Keeping every decision (bet sizing, the
hit/stand tables, dealer parsing, the reload rule, which crime to grind for seed
money) in a file that makes **no API calls** costs 0 GB and makes it testable
without the game:

```bash
node mocksuite.mjs casino-policy casino --verbose
```

**The save-scumming loop.** `casino.ts` saves after every win, so a win is
permanent, and reloads the page *without* saving when net winnings fall below the
peak by `--reload-after-losses` bets, which undoes the losses. The reload kills
the script; the save file restarts it. The run ends when the house bans you, which
the game records in `ns.getMoneySources().sinceInstall.casino` (10 billion).

**Being kicked out stops the casino for good.** Blackjack has no API, so the
kick-out is detected three ways: the modal on screen ("Alright cheater get out of
here"), the game's own winnings counter, and a `casino_banned.txt` note that
`casino.ts` writes on its server the moment the house throws it out. Every later
run reads that note and exits before travelling to Aevum, and `autobot.ts` checks
the same three signals before it schedules `casino.ts`:

```text
  casino.ts         skipped: the casino kicked us out for cheating
```

The orchestrator also kills a casino run that is already playing, and stops
muting `crime.ts`, `jobs.ts`, `factions.ts`, `bladeburner.ts` and `share.ts`,
because with the casino closed there is no focus conflict left.

**Focus conflict.** The player can only do one focused thing at a time, and a
faction job, a company job, a crime, a Bladeburner action or `share()` replaces the
casino page with the work page. Because `casino.ts` is scheduled by default, the
orchestrator reports those five subsystems as blocked:

```text
crime.ts        blocked  focus conflict: the casino drives the UI
jobs.ts         blocked  focus conflict: the casino drives the UI
factions.ts     blocked  focus conflict: the casino drives the UI
bladeburner.ts  blocked  focus conflict: the casino drives the UI
share.ts        blocked  focus conflict: the casino drives the UI
```

The mute is conditional: it only applies when `casino.ts` would actually run. Pass
`--no-casino`, `--skip casino`, get kicked out of the casino, or run out of a server
with 35 GB free and those five modules go back to work.

`sleeves.ts`, `go.ts` and `infiltration.ts` are unaffected: sleeve work belongs to
the sleeves, and Go/Infiltration are read through the API without opening a page.

If the focus is taken anyway, `casino.ts` clicks the game's "do something else
simultaneously" button before it gives up. Run it with `--dry-run` first: without a
browser it prints the plan and exits instead of touching the UI.

---

## Testing without the game

The repo ships a fake `ns` API so the whole suite can be exercised offline:

```bash
npm install                 # typescript + the transpiler used by the import check
npm run typecheck           # tsc --noEmit over every module
npm run imports             # replay the game's module resolver on every script
npm run ram                 # static RAM allocation vs. dynamic charge for every script
npm run enums               # every hardcoded name must be a real enum member
npm run selftest            # 36 known-answer contract checks
npm run fuzz                # 8400 randomized differential checks
npm run mock              # every module against a fake ns API
npm run suite             # same, 3 loops, verbose output
npm run installer         # install.js against the fake ns, one run per flag
                          # (includes the self-update: a stale install.js must
                          # download itself and hand over to the fresh copy)
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
node mocksuite.mjs crime --live             # actually call commitCrime/purchaseAugmentation
node mocksuite.mjs crime --live --blade-action Operations Raid   # Bladeburner is busy
node mocksuite.mjs stock --live             # buys WSE/TIX/4S, then trades
node mocksuite.mjs stock --live --disable-4s  # 4S data disabled: stock.ts bails out cleanly
node mocksuite.mjs --with-corp --with-stock # start with a corporation and full market access
node mocksuite.mjs _backdoortest --verbose  # the installBackdoor access-gate test
node mocksuite.mjs hacking --live --no-programs                    # owns nothing: buys everything on the darkweb
node mocksuite.mjs hacking --live --no-programs --no-tor --money 50000  # cannot afford TOR: logs and carries on
```

`--live` drops the `--dry-run` argument so the modules take their real code paths,
`--blade-action <type> <name>` puts the Bladeburner division into a running action so the
"crime cancels the Bladeburner action" guard is exercised, `--no-programs` / `--no-tor`
start the player with no `.exe` files and no router (which is how the darkweb purchase
path and its graceful failures are tested), and by default the mock starts
with **no corporation and no stock market access** so the subsystem guards are hit.

A module is reported as `[ok]`, `[ok (loop budget reached)]` or `[FAIL: ...]`.

---

## Project layout

```text
scripts/
  autobot.ts          orchestrator
  install.js          in-game bootstrap (the only file you paste manually)
  core.ts             shared helpers
  types.ts            shared types
  state.ts            shared timestamped state files + locks
  contracts.ts        24 contract solvers
  contractRunner.ts   contract discovery + submission
  hacking.ts hacknet.ts factions.ts jobs.ts crime.ts gang.ts
  bladeburner.ts corporation.ts stock.ts stanek.ts sleeves.ts
  go.ts infiltration.ts darknet.ts share.ts ascend.ts
  casino.ts casino-policy.ts        blackjack driver + its pure decision tables
  focus-policy.ts spending-policy.ts bitnode-policy.ts   the pure rules
  _backdoortest.ts    installBackdoor access-gate test (runs against the mock)
  _hacknettest.ts     hacknet-node filtering test (runs against the mock)

mocksuite.mjs         fake ns API, runs the whole suite offline
installcheck.mjs      runs scripts/install.js against that fake ns (wget stubbed to disk)
selftest.mjs          known-answer solver tests
fuzz.mjs              randomized differential tests
importcheck.mjs       replays the game's module resolver to catch bad imports
ramgap.mjs            static allocation vs. dynamic charge, per script
ramcheck.mjs          per-module RAM budget audit
enumcheck.mjs         every hardcoded enum name must be a real enum member
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
| `autobot.ts needs ~16 GB` | Run it on a server with at least 16 GB of **free** RAM (upgrade home RAM, root a bigger server, or kill what is already running there), or use `--only hacknet,share` until you have one. |
| `Dynamic RAM usage calculated to be greater than RAM allocation` | The script's declared budget is below what Bitburner actually allocates. Run `node ramgap.mjs` to see the real allocation of every module, then raise that module's `RAM_NEEDED`. This is also what happens if a module that calls the API is loaded through `ns.dynamicImport()`. |
| `Not enough RAM` in a module | That module's header lists the exact requirement. Root a bigger server or upgrade home RAM. |
| `Could not start autobot.ts` | `ns.exec()` returns `0` for three reasons, and the installer now prints which one applies: no root on the target, `autobot.ts` not on the target, or **not enough free RAM** - Bitburner allocates 15.15 GB for `autobot.ts`, so it needs a server with 16 GB free. Root a bigger server, kill what is running, or upgrade home RAM. |
| `Cannot find module logger.ts`, or a module refuses to start | The in-game `install.js` is older than the repo, so it never downloaded `logger.ts` - which every module now imports statically. `install.js` refreshes itself from GitHub on every run, so just `run install.js` again (drop `--no-update` if you were using it). |
| `Skipped loading player scripts during startup` | The game could not compile a script, usually because an imported file is missing. Check with `ls` that `core.ts`, `logger.ts` and `types.ts` are on the server, then re-run `install.js`. |
| A script is still creating programs (`Creating a program FTPCrack.exe`) | An old copy of a module is still running somewhere. `run install.js --kill`, then `run install.js` again. See [Programs: buy them, never create them](#programs-buy-them-never-create-them). |
| `createCorporation failed even though canCreateCorporation said Success` | Self-funding a corporation costs **$150 billion** (`costOfCreatingCorporation`), and `canCreateCorporation()` only checks SF3/BitNode - it never looks at your money. `corporation.ts` now checks the balance itself and prints the shortfall instead of this confusing line. Seed money is free but only legal in BitNode 3. |
| `Gangs need karma <= -54000 outside BitNode 2` | Not a bug: outside BitNode 2 a gang only forms once karma is at or below -54000. `crime.ts` drives karma down; let it run. |
| The same message printed every interval | `autobot.ts` mutes a module that exits straight away: after 2 quick exits it is left alone for 12 loops (60 s by default), then retried, and the wait doubles (12 → 24 → 48 → 96 → 120 loops) every time it fails again. The dashboard lists it as `skipped: cooldown: it keeps exiting immediately`. Use `--no-cooldown` to disable this. |
| A module shows as `blocked` | The dashboard prints why (missing Source-File, Bitnode requirement, not enough RAM, cooldown). It is not a bug. |
| `0 solved`, contracts skipped | That contract type has no solver yet — the runner prints `No solver for: ...` at the start. |
| Contract attempts exhausted | Use `--dry-run` first to verify answers before spending attempts. |
| `Argument ... should be a ... enum member` | A hardcoded name is not in the game's enum. See [Names the game validates](#names-the-game-validates-why-nothing-is-hardcoded) and run `node enumcheck.mjs`. |
| `Must own a corporation.` / `Must be in a gang.` / `Must be in the Bladeburner division.` | The module called a gated API before the subsystem existed. See [Subsystem access](#subsystem-access-must-own-a-corporation). |
| `You don't have TIX API Access!` / `You don't have 4S Market Data TIX API Access!` | `stock.ts` needs the WSE account, the TIX API and the 4S Market Data TIX API bought before it can read forecasts. It now buys them first and skips the tick if it cannot afford them. |
| `Cannot backdoor ... server because it is your server` | `installBackdoor()` has no target argument - it backdoors the server you are *connected to*. `hacking.ts` now filters owned servers and checks `connect()` before calling it. See [Backdoors](#backdoors-installbackdoor-has-no-target-argument). |
| `Cannot be executed on hacknet-server-N. The server must not be a hacknet server.` | Hacknet nodes show up in `ns.scan()` and report root access, but they are not `Server` objects, so every stat/hacking call on them throws. `core.rootedServers()` filters them out and `pickTarget()` re-checks defensively. See [Hacknet nodes are not servers](#hacknet-nodes-are-not-servers). |
| `No such exploit ('...') found on the darkweb!` | `getDarkwebProgramCost()` **throws** for anything the darkweb does not sell - `NUKE.exe` is not on it. `hacking.ts` only asks for `core.DARKWEB_PROGRAMS` and wraps the call in `core.tryCall`, so the suite never triggers this. See [Programs: buy them, never create them](#programs-buy-them-never-create-them). |
| `You do not have the TOR router.` | Singularity functions are gated by Source-File 4 / BitNode 4, and the darkweb needs the 100k TOR router. `hacking.ts` checks both and logs a line instead of crashing. |
| `Your Bladeburner action was cancelled` | `crime.ts` committed a crime while an operation was running. Run it with `--focus rep` on a sleeve, or let the guard skip the commit (it now does). |
| Want to stop everything | `run autobot.ts --kill` |

