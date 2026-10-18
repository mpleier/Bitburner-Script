import { readFileSync, writeFileSync } from "node:fs";

const ts = await import("typescript");
const T = ts.default ?? ts;

function loadModule(path) {
  const src = readFileSync(path, "utf8");
  const js = T.transpileModule(src, {
    compilerOptions: { target: T.ScriptTarget.ES2022, module: T.ModuleKind.CommonJS },
  }).outputText;
  const exportsObj = {};
  new Function("exports", js)(exportsObj);
  return exportsObj;
}

let report = "";
try {
  const lib = loadModule("scripts/contracts.ts");
  report += "exports: " + Object.keys(lib).join(", ") + "\n";
  const all = lib.CONTRACT_TYPES || [];
  const supported = lib.supportedTypes();
  const missing = all.filter((t) => !supported.includes(t));

  report += `game contract types: ${all.length}\n`;
  report += `solvers implemented: ${supported.length}\n`;
  report += `missing solvers: ${missing.length ? missing.join(", ") : "none"}\n\n`;

  const failures = lib.selfTest();
  report += `selfTest: ${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`}\n`;
  for (const f of failures) report += `  ${f}\n`;

  const spot = [
    ["Find Largest Prime Factor", 600851475143, 6857],
    ["Subarray with Maximum Sum", [-2, 1, -3, 4, -1, 2, 1, -5, 4], 6],
    ["Total Ways to Sum", 13, 100],
    ["Total Ways to Sum II", [13, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 97],
    ["Spiralize Matrix", [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 2, 3, 6, 9, 8, 7, 4, 5]],
    ["Array Jumping Game", [1, 2, 3, 4], 1],
    ["Array Jumping Game II", [2, 3, 1, 1, 2, 4, 1, 3, 1, 2, 1, 1, 1, 1, 1, 10], 9],
    ["Merge Overlapping Intervals", [[1, 3], [2, 6], [8, 10], [15, 18]], [[1, 6], [8, 10], [15, 18]]],
    ["Generate IP Addresses", "232232222222", ["232.232.222.222"]],
    ["Algorithmic Stock Trader I", [1, 2, 3, 4, 5, 6, 7], 6],
    ["Algorithmic Stock Trader II", [1, 2, 3, 4, 5, 6, 7], 6],
    ["Algorithmic Stock Trader III", [1, 2, 3, 4, 5, 6, 7], 6],
    ["Algorithmic Stock Trader IV", [2, [1, 2, 3, 4, 5, 6, 7]], 6],
    ["Minimum Path Sum in a Triangle", [[1], [2, 3], [4, 5, 6]], 7],
    ["Unique Paths in a Grid I", [3, 4], 10],
    ["Unique Paths in a Grid II", [[0, 1, 0], [0, 1, 0], [0, 0, 0]], 1],
    ["Shortest Path in a Grid", [[0, 1, 0, 0, 0], [0, 0, 0, 1, 0]], "DRRURRD"],
    ["Shortest Path in a Grid", [[0, 1], [1, 0]], ""],
    ["Sanitize Parentheses in Expression", "(unbalanced(parens", ["unbalancedparens"]],
    ["Find All Valid Math Expressions", ["123", 6], ["1+2+3", "1*2*3"]],
    ["HammingCodes: Integer to Encoded Binary", 8, "11110000"],
    ["HammingCodes: Integer to Encoded Binary", 21, "1001101011"],
    ["HammingCodes: Encoded Binary to Integer", "1001101010", 21],
    ["Proper 2-Coloring of a Graph", [4, [[0, 2], [0, 3], [1, 2], [1, 3]]], [0, 0, 1, 1]],
    ["Proper 2-Coloring of a Graph", [3, [[0, 1], [0, 2], [1, 2]]], []],
    ["Compression I: RLE Compression", "aaaaabccc", "5a1b3c"],
    ["Compression I: RLE Compression", "aAaAaA", "1a1A1a1A1a1A"],
    ["Compression I: RLE Compression", "111112333", "511233"],
    ["Compression I: RLE Compression", "z".repeat(21), "9z9z3z"],
    ["Compression II: LZ Decompression", "5aaabb450723abb", "aaabbaaababababaabb"],
    ["Encryption I: Caesar Cipher", ["HELLO WORLD", 3], "EBIIL TLOIA"],
    ["Encryption II: Vigenère Cipher", ["HELLO WORLD", "KEY"], "RIJVS GSPVH"],
    ["Square Root", 1234567900987654321n, "1111111111"],
    ["Total Number of Primes", [0, 20], 8],
    ["Largest Rectangle in a Matrix", [[1, 0, 0], [0, 0, 0]], [[0, 1], [1, 2]]],
    ["Largest Rectangle in a Matrix", [[0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 1]], [[0, 0], [1, 1]]],
  ];

  report += "\nspot checks:\n";
  let ok = 0;
  for (const [type, data, expected] of spot) {
    if (!supported.includes(type)) {
      report += `  SKIP  ${type} (no solver)\n`;
      continue;
    }
    const raw = lib.solve(type, data);
    const got = typeof raw === "bigint" ? raw.toString() : raw;
    const same = JSON.stringify(got) === JSON.stringify(expected);
    if (same) ok++;
    report += `  ${same ? "OK   " : "WRONG"} ${type} -> ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})\n`;
  }
  report += `\nspot checks: ${ok}/${spot.length} passed\n`;

  report += "\nLZ round-trip:\n";
  for (const s of ["aaaabbb", "hello world hello world", "a".repeat(50), "abcabcabcabcabcabcabc", "9z9z1z"]) {
    const enc = lib.solve("Compression III: LZ Compression", s);
    const back = lib.solve("Compression II: LZ Decompression", enc);
    report += `  ${JSON.stringify(s)} -> ${JSON.stringify(enc)} -> ${JSON.stringify(back)} : ${back === s ? "OK" : "MISMATCH"}\n`;
  }
} catch (e) {
  report += "FATAL: " + e.message + "\n" + e.stack + "\n";
}

writeFileSync("selftest_result.txt", report);
console.log(report);