// runselftest.mjs - invoke the selfTest() that contractRunner.ts calls in-game
import solvers from "./build/contracts.js";

const failures = solvers.selfTest();
if (failures.length) {
  console.log("selfTest FAILED (" + failures.length + "):");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
console.log("selfTest: all passed (" + solvers.supportedTypes().length + " types supported)");
