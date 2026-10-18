// Cross-checks every solver in scripts/contracts.ts against the OFFICIAL
// Bitburner reference implementations (generate/getAnswer/solver from game source).
import fs from "node:fs";

globalThis.getRandomIntInclusive = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
globalThis.randomBigIntExclusive = (n) => {
  if (n <= 0n) return 0n;
  let bits = 0, t = n;
  while (t > 0n) { t >>= 1n; bits++; }
  const bytes = Math.ceil(bits / 8);
  for (;;) {
    let r = 0n;
    for (let k = 0; k < bytes; k++) r = (r << 8n) | BigInt(Math.floor(Math.random() * 256));
    if (r < n) return r;
  }
};

function stripTs(code) {
  const n = code.length;
  let out = "";
  let i = 0;

  function skipType(stopChars) {
    // skip a type expression until one of stopChars at depth 0
    let d = 0;
    while (i < n) {
      const c = code[i];
      if (c === "(" || c === "[" || c === "<") { d++; i++; continue; }
      if (c === ")" || c === "]" || c === ">") { if (d > 0) { d--; i++; continue; } break; }
      if (d === 0 && stopChars.includes(c)) break;
      i++;
    }
  }

  function stripParamList() {
    // code[i] === '('
    out += "(";
    i++;
    let depth = 1;
    while (i < n && depth > 0) {
      const c = code[i];
      if (c === "(") { depth++; out += c; i++; continue; }
      if (c === ")") {
        depth--;
        if (depth === 0) { out += c; i++; return; }
        out += c; i++; continue;
      }
      if (c === "{") {
        let bd = 0;
        while (i < n) {
          if (code[i] === "{") bd++;
          else if (code[i] === "}") { bd--; if (bd === 0) { i++; break; } }
          i++;
        }
        continue;
      }
      if (c === ":") { skipType([",", ")"]); continue; }
      out += c; i++;
    }
  }

  while (i < n) {
    const c = code[i];

    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c; i++;
      while (i < n) {
        if (code[i] === "\\") { out += code[i] + (code[i + 1] ?? ""); i += 2; continue; }
        if (code[i] === q) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") { out += code[i]; i++; }
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) { out += code[i]; i++; }
      out += "*/"; i += 2; continue;
    }

    if (c === "(") {
      const before = out.trimEnd();
      const isFunc = /^\s*(function\s*\*?\s*\w*|\w+)\s*$/.test(before);
      if (isFunc) {
        stripParamList();
        // optional return type
        let j = i;
        while (j < n && code[j] === " ") j++;
        if (code[j] === ":") {
          i = j + 1;
          skipType(["{", "\n", "="]);
          out += " ";
        }
        continue;
      }
      // arrow param list?
      let depth = 0, j = i;
      while (j < n) {
        if (code[j] === "(") depth++;
        else if (code[j] === ")") { depth--; if (depth === 0) break; }
        j++;
      }
      let k = j + 1;
      while (k < n && (code[k] === " " || code[k] === "\n")) k++;
      if (code[k] === "=" && code[k + 1] === ">") { stripParamList(); continue; }
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z_0-9]/.test(code[j])) j++;
      const word = code.slice(i, j);
      i = j;
      if (word === "as" && out.endsWith(" ")) { skipType([";", ",", ")", "\n"]); continue; }
      out += word;
      if (code[i] === "<") {
        // generic type arguments only when immediately followed by "("
        let d = 0, j = i;
        while (j < n && j - i < 80) {
          if (code[j] === "<") d++;
          else if (code[j] === ">") { d--; if (d === 0) break; }
          j++;
        }
        if (j < n && d === 0 && code[j] === ">" && code[j + 1] === "(") i = j + 1;
      }
      continue;
    }

    if (c === ":" && /\b(const|let|var)\s+[A-Za-z_0-9]+$/.test(out)) {
      i++;
      skipType(["=", ";", "\n"]);
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

const src = stripTs(fs.readFileSync("scripts/contracts.ts", "utf8").replace(/namespace NS\b/g, "").replace(/^export /gm, ""));
const lib = new Function(src + "\nreturn { solve, supportedTypes, selfTest, normalize };")();
const { solve, supportedTypes, selfTest } = lib;

function extractBlocks(file, key) {
  const t = fs.readFileSync(file, "utf8");
  const out = {};
  const nameRe = /\[CodingContractName\.(\w+)\]:\s*\{/g;
  const spots = [];
  let m;
  while ((m = nameRe.exec(t))) spots.push({ name: m[1], start: m.index });
  for (const s of spots) {
    const limit = spots.find((x) => x.start > s.start)?.start ?? t.length;
    const gi = t.indexOf(key + ":", s.start);
    if (gi < 0 || gi > limit) continue;
    const arrow = t.indexOf("=>", gi);
    if (arrow < 0) continue;
    let i = arrow + 2;
    while (i < t.length && " \n\r(".includes(t[i])) i++;
    if (t[i] !== "{") continue;
    let depth = 0, end = i;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    try {
      out[s.name] = new Function("data", "answer", helpersFor(file) + "\n" + stripTs(t.slice(i + 1, end)));
    } catch (e) {
      const body = helpersFor(file) + "\n" + stripTs(t.slice(i + 1, end));
      console.log(`  ! ${file} ${s.name} ${key}: ${e.message}`);
      console.log("    " + (body.split("\n").find((l) => l.includes("<")) || ""));
    }
  }
  return out;
}

function extractHelpers(file) {
  const t = fs.readFileSync(file, "utf8");
  let out = "";
  const re = /^function \w+\(/gm;
  let m;
  while ((m = re.exec(t))) {
    let i = m.index, depth = 0, end = -1;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end > 0) out += stripTs(t.slice(i, end + 1)) + "\n";
  }
  return out;
}

const helperCache = {};
function helpersFor(file) {
  if (!helperCache[file]) helperCache[file] = extractHelpers(file);
  return helperCache[file];
}
const ENUM = {};


for (const line of fs.readFileSync("ContractEnums.ts", "utf8").split("\n")) {
  const m = line.match(/(\w+)\s*=\s*"([^"]+)"/);
  if (m) ENUM[m[1]] = m[2];
}

const files = fs.readdirSync(".").filter((f) => f.startsWith("c_") && f.endsWith(".ts"));
const refAnswer = {}, refGenerate = {}, refSolver = {};
for (const f of files) {
  try {
    Object.assign(refAnswer, extractBlocks(f, "getAnswer"));
    Object.assign(refGenerate, extractBlocks(f, "generate"));
    Object.assign(refSolver, extractBlocks(f, "solver"));
  } catch (e) {
    console.log(`  ! could not parse ${f}: ${e.message}`);
  }
}

console.log(`Parsed official blocks: getAnswer=${Object.keys(refAnswer).length}, ` +
  `generate=${Object.keys(refGenerate).length}, solver=${Object.keys(refSolver).length}\n`);

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a === "bigint" || typeof b === "bigint") return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEq(v, b[i]));
  }
  return false;
}

let pass = 0, fail = 0;
const failures = [];

// The Hamming reference file defines its helpers as top-level functions, so
// provide them explicitly.
refAnswer.HammingCodesIntegerToEncodedBinary = (data) => {
  const enc = [0];
  const data_bits = data.toString(2).split("").reverse().map((v) => parseInt(v));
  let k = data_bits.length;
  for (let i = 1; k > 0; i++) {
    if ((i & (i - 1)) != 0) enc[i] = data_bits[--k];
    else enc[i] = 0;
  }
  let parityNumber = 0;
  for (let i = 0; i < enc.length; i++) if (enc[i]) parityNumber ^= i;
  const parityArray = parityNumber.toString(2).split("").reverse().map((v) => parseInt(v));
  for (let i = 0; i < parityArray.length; i++) enc[2 ** i] = parityArray[i] ? 1 : 0;
  parityNumber = 0;
  for (let i = 0; i < enc.length; i++) if (enc[i]) parityNumber++;
  enc[0] = parityNumber % 2 == 0 ? 0 : 1;
  return enc.join("");
};
refAnswer.HammingCodesEncodedBinaryToInteger = (data) => {
  let err = 0;
  const bits = [];
  for (let i = 0; i < data.length; ++i) {
    const bit = parseInt(data[i]);
    bits[i] = bit;
    if (bit) err ^= +i;
  }
  if (err) bits[err] = bits[err] ? 0 : 1;
  let ans = "";
  for (let i = 1; i < bits.length; i++) if ((i & (i - 1)) != 0) ans += bits[i];
  return parseInt(ans, 2);
};

const supported = new Set(supportedTypes());

for (const key of Object.keys(ENUM)) {
  const name = ENUM[key];
  if (!supported.has(name)) {
    console.log(`SKIP  ${name} (not implemented)`);
    continue;
  }
  const gen = refGenerate[key];
  if (!gen) { console.log(`SKIP  ${name} (no generate fn parsed)`); continue; }

  const trials = name === "Square Root" ? 40 : name === "Total Number of Primes" ? 3 : 200;
  for (let t = 0; t < trials; t++) {
    let data;
    try { data = gen(); } catch (e) { console.log(`SKIP  ${name}: ${e.message}`); break; }

    if (name === "Square Root") {
      // official generate returns [root, offset]; the contract data is root^2 + offset
      const root = BigInt(data[0]);
      const offset = BigInt(data[1]);
      const input = root * root + offset;
      const mine = solve(name, input);
      if (String(mine) !== data[0]) {
        failures.push(`Square Root\n    data=${input}\n    official=${data[0]} mine=${mine}`);
        fail++;
      } else pass++;
      continue;
    }
    let mine;
    try { mine = solve(name, data); } catch (e) {
      failures.push(`${name}  data=${JSON.stringify(data)}  threw: ${e.message}`);
      fail++;
      continue;
    }
    let officialAnswer = null;
    try {
      officialAnswer = refAnswer[key] ? refAnswer[key](data, null) : null;
    } catch (e) {
      officialAnswer = null; // reference getAnswer needs helpers; fall back to solver
    }
    if (officialAnswer !== null && officialAnswer !== undefined) {
      if (!deepEq(officialAnswer, mine)) {
        failures.push(`${name}\n    data=${JSON.stringify(data)}\n    official=${JSON.stringify(officialAnswer)} mine=${JSON.stringify(mine)}`);
        fail++;
      } else pass++;
    } else if (refSolver[key]) {
      const ok = refSolver[key](data, mine);
      if (!ok) {
        failures.push(`${name}\n    data=${JSON.stringify(data)}\n    my answer rejected by official solver: ${JSON.stringify(mine)}`);
        fail++;
      } else pass++;
    } else {
      console.log(`SKIP  ${name} (no reference answer/solver)`);
    }
  }
}

console.log(`\n=== Cross-check vs official source: ${pass} passed, ${fail} failed ===`);
for (const f of failures.slice(0, 25)) console.log("  " + f);

