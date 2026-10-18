/**
 * _backdoortest.ts
 * ============================================================================
 * Guard test for ns.singularity.installBackdoor().
 *
 * The real game (src/Singularity.ts -> src/Hacking/netscriptCanHack.ts) has no
 * hostname argument for installBackdoor(): it always backdoors
 * Player.getCurrentServer(), and refuses when
 *   - the server is owned by the player -> "Cannot backdoor <host> server because it is your server"
 *   - we have no root                   -> "Cannot backdoor <host> server because you do not have root access"
 *   - our hacking level is too low      -> "Cannot hack <host> server because your hacking skill is not high enough"
 *
 * ns.singularity.connect() returns false when the target is neither adjacent to
 * the server we are currently on nor already backdoored. Ignoring that return
 * value is exactly what makes hacking.ts crash with "it is your server".
 *
 * mocksuite.mjs implements all of these rules, so this script is a live check
 * that the guards in hacking.ts are really needed.
 *
 * Usage
 *   node mocksuite.mjs _backdoortest --verbose
 */

const RAM_NEEDED = 8;

export async function main(ns: NS): Promise<void> {
  const log: string[] = [];
  const failures: string[] = [];

  const check = async (label: string, host: string, expected: string): Promise<void> => {
    let outcome: string;
    if (!ns.singularity.connect(host)) {
      outcome = "unreachable";
    } else {
      try {
        await ns.singularity.installBackdoor();
        outcome = "installed";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("it is your server")) outcome = "your server";
        else if (msg.includes("do not have root access")) outcome = "root access";
        else if (msg.includes("hacking skill is not high enough")) outcome = "skill";
        else outcome = `unexpected: ${msg}`;
      }
    }
    log.push(`${label.padEnd(26)} ${host.padEnd(8)} -> ${outcome}`);
    if (outcome !== expected) failures.push(`${label}: expected "${expected}", got "${outcome}"`);
  };

  ns.print("=== backdoor guard test ===");

  const here = ns.getHostname();
  if (ns.getServerMaxRam(here) < RAM_NEEDED) {
    ns.tprint(`_backdoortest.ts needs ${RAM_NEEDED} GB; ${here} has ${ns.getServerMaxRam(here)} GB.`);
    return;
  }

  // 1. home is purchasedByPlayer -> the exact game error hacking.ts used to hit.
  await check("own computer", "home", "your server");

  // 2. A purchased cloud server is owned too -> same error.
  await check("purchased cloud server", "C-1", "your server");

  // 3. Walk back to home, then try a foreign server we have not rooted yet.
  ns.singularity.connect("home");
  await check("foreign, not rooted", "n0002", "root access");

  // 4. Root it: the backdoor now succeeds.
  await ns.nuke("n0002");
  await check("foreign, rooted", "n0002", "installed");

  // 5. Adjacent foreign server whose required level is above ours.
  await ns.nuke("n0024");
  await check("foreign, level too low", "n0024", "skill");

  // 6. The World Daemon: foreign, but needs hacking 2000.
  await ns.nuke("daemon");
  await check("world daemon", "daemon", "skill");

  // 7. Not adjacent to where we are and not backdoored -> connect() returns false.
  await check("not adjacent", "n0011", "unreachable");

  for (const line of log) ns.print(line);

  if (failures.length > 0) {
    throw new Error(`backdoor guard test failed:\n  ${failures.join("\n  ")}`);
  }
  ns.tprint(`backdoor guard test: ${log.length}/${log.length} assertions passed`);
}