// Node 22.6+ strips the TypeScript types in contracts.ts, so this runs directly.
import { solve, selfTest, supportedTypes } from "./contracts.ts";

const failures = selfTest();
console.log(`Supported contract types: ${supportedTypes().length}`);

if (failures.length === 0) {
  console.log("All self-tests passed.");
} else {
  console.log("FAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exitCode = 1;
}

// Extra spot-checks
console.log("Prime 60 ->", solve("Find Largest Prime Factor", 60));
console.log("LZ('ABABABABABAB') ->", solve("Compression III: LZ Compression", "ABABABABABAB"));
console.log("LZ round trip ->", solve("Compression II: LZ Decompression", solve("Compression III: LZ Compression", "ABABABABABAB")));
