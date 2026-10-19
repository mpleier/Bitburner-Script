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
| `autobot.ts` | 15 GB | — | Orchestrator: installs, plans, places, starts, monitors |
| `core.ts` | 11.3 GB* | — | Shared helpers (BFS scan, rooting, formatting, Bladeburner/work conflict guards), statically imported by every module |
| `logger.ts` | 0.05 GB* | — | Routes every module's output into a log file instead of the terminal |
| `types.ts` | 0 GB | — | Shared type definitions (type-only import, erased by the transpiler) |
| `hacking.ts` | 35 GB | — | Buys programs on the darkweb, roots servers, leaves backdoors, weaken → grow → hack, upgrades home RAM |
| `hacknet.ts` | 21 GB | — | Buys/upgrades nodes, spends hash on the best thing |
| `contractRunner.ts` | 29 GB | — | Finds every `*.cct` on the network and solves it with 24 built-in solvers |
| `contracts.ts` | 0 GB* | — | The solvers themselves (they make no API calls, so `dynamicImport` is safe) |
| `factions.ts` | 55 GB | — | Work for factions, donate, buy augmentations |
| `jobs.ts` | 24 GB | — | Applies for the highest-paying job across all 25 companies |
| `crime.ts` | 43 GB | — | Picks the best crime by expected money/sec, shadow-chains faction reps |
| `gang.ts` | 46 GB | BN2 / SF2 | Recruits, assigns optimal tasks, buys weapons, ascends |
| `bladeburner.ts` | 78 GB | BN6-7 / SF6 | City selection, contracts/ops, skill-point spending |
| `corporation.ts` | 462 GB | BN3 / SF3 | Self-managing corporation: divisions, offices, hires, materials, research |
| `stock.ts` | 45 GB | BN8 / SF8 | Tick-based trading with position sizing |
| `stanek.ts` | 26 GB | BN13 / SF13 | Greedy fragment packing with rotation, charges everything |
| `sleeves.ts` | 48 GB | BN10 / SF10 | Shock recovery → sync → stat-matched task per sleeve |
| `go.ts` | 60 GB | BN14 / SF14 | Plays Go using atari/liberty analysis, collects rewards |
| `infiltration.ts` | 27 GB | — | Ranks SP500 locations by expected value, infiltrates the best |
| `darknet.ts` | 26 GB | BN15 / SF15 | Harvests stasis links, probes neighbours, heartbleeds logs |
| `share.ts` | 6 GB | — | Fills leftover RAM with `share()` for faction work |

\* `core.ts` is **statically** imported, so its API calls are added to every module that
imports it. `contracts.ts` is the only `ns.dynamicImport()` in the suite, and that is safe
only because it makes no API calls at all. Every module needs `core.ts`, `types.ts` and
`contracts.ts` on the same server — `autobot.ts` `scp`s them there automatically.

Total RAM if every module ran at once: **~1,060 GB** (with Source-File 4 installed). Without
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

`install.js` is the one file the game cannot update by itself, so if you pasted it a long
ago and it is missing a file (e.g. `logger.ts`), refresh the installer first:

```text
wget https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/install.js install.js
run install.js
```

### 2. Watch it

Every module writes to `autobot_log.txt` on the server it runs on, so the log is where the
action is:

```text
cat autobot_log.txt
run install.js --logs 30      # last 30 log lines, works on an 8 GB home server
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
run autobot.ts --kill     # same, but autobot.ts itself needs 15 GB of RAM
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
| `--logs 50` | Dump the last 50 lines of the log file to the terminal and exit |
| `--log mybot.txt` | Write the log to a different file |
| `--ref main` | Which branch/tag to download from |

`install.js` accepts the same flags plus `--open-ports` (root everything you can),
`--no-run` (install only), `--server n0006` (force where the bot runs), `--selftest`
(one dry-run pass of the orchestrator), `--kill` (stop the whole suite from a small
server - `install.js` only needs ~7 GB, `autobot.ts` needs 15 GB) and `--logs N`
(read the log without running anything).

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
- **Milestones and fatal errors still `tprint`.** `logger.tlog()` writes to the file
  *and* to the console, so "not enough RAM" / "corporation disabled" is never missed.
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
  if (dryRun) { ns.print("[dry-run] would create a corporation"); return; }
  if (!ns.corporation.createCorporation("Bitburner Industries", true)) return;
}
// a corporation is guaranteed to exist from here on
await ns.corporation.nextUpdate();
```

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
  contracts.ts        24 contract solvers
  contractRunner.ts   contract discovery + submission
  hacking.ts hacknet.ts factions.ts jobs.ts crime.ts gang.ts
  bladeburner.ts corporation.ts stock.ts stanek.ts sleeves.ts
  go.ts infiltration.ts darknet.ts share.ts
  _backdoortest.ts    installBackdoor access-gate test (runs against the mock)
  _hacknettest.ts     hacknet-node filtering test (runs against the mock)

mocksuite.mjs         fake ns API, runs the whole suite offline
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
| `autobot.ts needs ~15 GB` | Run it on a server with at least 15 GB of **free** RAM (upgrade home RAM, root a bigger server, or kill what is already running there), or use `--only hacknet,share` until you have one. |
| `Dynamic RAM usage calculated to be greater than RAM allocation` | The script's declared budget is below what Bitburner actually allocates. Run `node ramgap.mjs` to see the real allocation of every module, then raise that module's `RAM_NEEDED`. This is also what happens if a module that calls the API is loaded through `ns.dynamicImport()`. |
| `Not enough RAM` in a module | That module's header lists the exact requirement. Root a bigger server or upgrade home RAM. |
| `Could not start autobot.ts` | `ns.exec()` returns `0` for three reasons, and the installer now prints which one applies: no root on the target, `autobot.ts` not on the target, or **not enough free RAM** - Bitburner allocates 14.15 GB for `autobot.ts`, so it needs a server with 15 GB free. Root a bigger server, kill what is running, or upgrade home RAM. |
| `Cannot find module logger.ts`, or a module refuses to start | The in-game `install.js` is older than the repo, so it never downloaded `logger.ts` - which every module now imports statically. Refresh the installer and re-run it: `wget https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/install.js install.js` then `run install.js`. |
| `Skipped loading player scripts during startup` | The game could not compile a script, usually because an imported file is missing. Check with `ls` that `core.ts`, `logger.ts` and `types.ts` are on the server, then re-run `install.js`. |
| A script is still creating programs (`Creating a program FTPCrack.exe`) | An old copy of a module is still running somewhere. `run install.js --kill`, then `run install.js` again. See [Programs: buy them, never create them](#programs-buy-them-never-create-them). |
| A module shows as `blocked` | The dashboard prints why (missing Source-File, Bitnode requirement, not enough RAM). It is not a bug. |
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

