/**
 * _hacknettest.ts - mock-suite regression test for the hacknet guard.
 *
 * Hacknet nodes are on the network and report root access, but they are
 * HacknetServer rather than Server objects, so helpers.getNormalServer() throws
 * for them. hacking.ts used to die in pickTarget() with:
 *   "getServerRequiredHackingLevel: Cannot be executed on hacknet-server-0.
 *    The server must not be a hacknet server."
 *
 * This module asserts that core filters them out of the rooted list while still
 * allowing them to host scripts, and that the mock really throws the way the
 * game does. Run with: node mocksuite.mjs _hacknettest
 */
import * as core from "./core.ts";
import * as logger from "./logger.ts";

export async function main(ns: NS): Promise<void> {
  const hosts = core.discover(ns);
  const hacknet = hosts.filter((h: string) => core.isHacknetServer(h));

  if (hacknet.length === 0) {
    logger.log(ns, "no hacknet nodes in the mock network - nothing to test");
    return;
  }

  const rooted = core.rootedServers(ns);
  const scriptable = core.scriptHosts(ns);

  for (const host of hacknet) {
    if (!ns.hasRootAccess(host)) throw new Error(`mock is not faithful: ${host} should report root access`);
    if (rooted.includes(host)) throw new Error(`core.rootedServers() must exclude ${host}`);
    if (!scriptable.includes(host)) throw new Error(`core.scriptHosts() must include ${host}`);
    if (core.rootServer(ns, host)) throw new Error(`core.rootServer() must refuse ${host}`);

    // The exact call that crashed pickTarget(): it must never reach a hacknet node.
    try {
      ns.getServerRequiredHackingLevel(host);
      throw new Error(`mock is not faithful: getServerRequiredHackingLevel(${host}) should throw`);
    } catch (err) {
      if (!String(err).includes("hacknet")) throw err;
    }
  }

  logger.log(ns, `hacknet guard ok: ${hacknet.length} nodes (${hacknet.join(", ")})`);
  logger.log(ns, `rootedServers(): ${rooted.join(", ")} (hacknet nodes excluded)`);
  logger.log(ns, `scriptHosts():   ${scriptable.join(", ")} (hacknet nodes included)`);
}