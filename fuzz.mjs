import { execSync } from "node:child_process";

execSync("npx tsc --target ES2020 --module commonjs --strict --noEmit false --outDir build scripts/contracts.ts");
import solvers from "./build/contracts.js";

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const failures = [];
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (!cond) failures.push(`${name}: ${detail}`);
}

/* ---------------- independent references ---------------- */

function refLargestPrimeFactor(n) {
  let p = 2;
  while (n % 2 === 0) { p = 2; n /= 2; }
  for (let i = 3; i * i <= n; i += 2) {
    while (n % i === 0) { p = i; n /= i; }
  }
  return n > 1 ? n : p;
}

function refMaxSubarray(a) {
  let best = -Infinity;
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    for (let j = i; j < a.length; j++) { s += a[j]; best = Math.max(best, s); }
  }
  return best;
}

function refWaysToSum(n) {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (let k = 1; k < n; k++) for (let s = k; s <= n; s++) dp[s] += dp[s - k];
  return dp[n];
}

function refWaysToSumII(n, coins) {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const c of coins) for (let s = c; s <= n; s++) dp[s] += dp[s - c];
  return dp[n];
}

function refSpiral(m) {
  if (!m.length) return [];
  const out = [];
  let top = 0, bottom = m.length - 1, left = 0, right = m[0].length - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push(m[top][c]);
    top++;
    for (let r = top; r <= bottom; r++) out.push(m[r][right]);
    right--;
    if (top <= bottom) { for (let c = right; c >= left; c--) out.push(m[bottom][c]); bottom--; }
    if (left <= right) { for (let r = bottom; r >= top; r--) out.push(m[r][left]); left++; }
  }
  return out;
}

function refCanJump(a) {
  let reach = 0;
  for (let i = 0; i < a.length && i <= reach; i++) reach = Math.max(reach, i + a[i]);
  return reach >= a.length - 1 ? 1 : 0;
}

function refMinJumps(a) {
  const n = a.length;
  const dist = new Array(n).fill(-1);
  dist[0] = 0;
  for (let i = 0; i < n; i++) {
    if (dist[i] < 0) return 0;
    for (let j = i + 1; j <= i + a[i] && j < n; j++) {
      if (dist[j] < 0) dist[j] = dist[i] + 1;
    }
  }
  return dist[n - 1];
}

function refMaxProfitDP(prices, k) {
  const n = prices.length;
  if (n < 2 || k < 1) return 0;
  const dp = new Array(k + 1).fill(0);
  const best = new Array(k + 1).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= k; j++) {
      dp[j] = Math.max(dp[j], best[j] + prices[i]);
      best[j] = Math.max(best[j], dp[j - 1] - prices[i]);
    }
  }
  return dp[k];
}

function refTriangle(tri) {
  const dp = tri[tri.length - 1].slice();
  for (let r = tri.length - 2; r >= 0; r--) {
    for (let c = 0; c <= r; c++) dp[c] = tri[r][c] + Math.min(dp[c], dp[c + 1]);
  }
  return dp[0];
}

function refUniquePaths(grid) {
  const R = grid.length, C = grid[0].length;
  const dp = Array.from({ length: R }, () => new Array(C).fill(0));
  dp[0][0] = grid[0][0] === 0 ? 1 : 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (grid[r][c] !== 0) continue;
      if (r > 0) dp[r][c] += dp[r - 1][c];
      if (c > 0) dp[r][c] += dp[r][c - 1];
    }
  }
  return dp[R - 1][C - 1];
}

function refGridDist(grid) {
  const R = grid.length, C = grid[0].length;
  if (grid[R - 1][C - 1] !== 0) return null;
  const dist = Array.from({ length: R }, () => new Array(C).fill(Infinity));
  dist[0][0] = 0;
  const q = [[0, 0]];
  while (q.length) {
    const [r, c] = q.shift();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C || grid[nr][nc] !== 0) continue;
      if (dist[nr][nc] > dist[r][c] + 1) {
        dist[nr][nc] = dist[r][c] + 1;
        q.push([nr, nc]);
      }
    }
  }
  return dist[R - 1][C - 1] === Infinity ? null : dist[R - 1][C - 1];
}

function refValidParen(s) {
  let bal = 0;
  for (const c of s) {
    if (c === "(") bal++;
    else if (c === ")") { bal--; if (bal < 0) return false; }
  }
  return bal === 0;
}

function refSanitize(s) {
  let left = 0, right = 0;
  for (const c of s) {
    if (c === "(") left++;
    else if (c === ")") { if (left > 0) left--; else right++; }
  }
  const best = left + right;
  const seen = new Set();
  const n = s.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let removed = 0, out = "";
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { removed++; continue; }
      out += s[i];
    }
    if (removed === best && refValidParen(out)) seen.add(out);
  }
  return [...seen];
}

function evalTokens(nums, ops) {
  let acc = 0, term = nums[0];
  for (let i = 0; i < ops.length; i++) {
    const v = nums[i + 1];
    if (ops[i] === "*") term *= v;
    else if (ops[i] === "+") { acc += term; term = v; }
    else { acc += term; term = -v; }
  }
  return acc + term;
}

function refMathExpressions(num, target) {
  const out = new Set();
  const n = num.length;
  function rec(pos, nums, ops) {
    if (pos === n) {
      if (evalTokens(nums, ops) === target) {
        let s = String(nums[0]);
        for (let i = 0; i < ops.length; i++) s += ops[i] + nums[i + 1];
        out.add(s);
      }
      return;
    }
    for (let i = pos; i < n; i++) {
      if (i !== pos && num[pos] === "0") break;
      const v = Number(num.slice(pos, i + 1));
      if (pos === 0) rec(i + 1, [v], []);
      else for (const op of ["+", "-", "*"]) rec(i + 1, [...nums, v], [...ops, op]);
    }
  }
  rec(0, [], []);
  return [...out];
}

function refRleDecode(s) {
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const count = Number(s[i]);
    out += s[i + 1].repeat(count);
  }
  return out;
}

function refIsqrtFloor(n) {
  let lo = 0n, hi = n < 2n ? n : (1n << BigInt(Math.ceil((n.toString(2).length + 1) / 2)));
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid * mid <= n) lo = mid; else hi = mid - 1n;
  }
  return lo;
}

function refIP(s) {
  const out = new Set();
  for (let a = 1; a <= 3; a++)
    for (let b = 1; b <= 3; b++)
      for (let c = 1; c <= 3; c++) {
        const d = s.length - a - b - c;
        if (d < 1 || d > 3) continue;
        const segs = [s.slice(0, a), s.slice(a, a + b), s.slice(a + b, a + b + c), s.slice(a + b + c)];
        if (segs.some((x) => x.length > 1 && x[0] === "0")) continue;
        if (segs.some((x) => Number(x) > 255)) continue;
        out.add(segs.join("."));
      }
  return [...out];
}

function refLargestZeroRectangle(grid) {
  const R = grid.length, C = grid[0].length;
  let best = 0;
  for (let r1 = 0; r1 < R; r1++)
    for (let c1 = 0; c1 < C; c1++) {
      if (grid[r1][c1] !== 0) continue;
      for (let r2 = r1; r2 < R; r2++)
        for (let c2 = c1; c2 < C; c2++) {
          let all = true;
          for (let r = r1; r <= r2 && all; r++)
            for (let c = c1; c <= c2; c++) if (grid[r][c] !== 0) { all = false; break; }
          if (all) best = Math.max(best, (r2 - r1 + 1) * (c2 - c1 + 1));
        }
    }
  return best;
}

function isBipartite(V, edges) {
  const adj = Array.from({ length: V }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const col = new Array(V).fill(-1);
  for (let s = 0; s < V; s++) {
    if (col[s] !== -1) continue;
    col[s] = 0;
    const q = [s];
    while (q.length) {
      const u = q.pop();
      for (const v of adj[u]) {
        if (col[v] === -1) { col[v] = col[u] ^ 1; q.push(v); }
        else if (col[v] === col[u]) return false;
      }
    }
  }
  return true;
}

/* ---------------- fuzz loops ---------------- */

const TOTAL = 300;
for (let t = 0; t < TOTAL; t++) {
  const n = ri(2, 100000);
  check("Find Largest Prime Factor", solvers.solve("Find Largest Prime Factor", n) === refLargestPrimeFactor(n), `n=${n}`);

  const arr = Array.from({ length: ri(1, 30) }, () => ri(-100, 100));
  check("Subarray with Maximum Sum", solvers.solve("Subarray with Maximum Sum", arr) === refMaxSubarray(arr), JSON.stringify(arr));

  const m = ri(1, 60);
  check("Total Ways to Sum", solvers.solve("Total Ways to Sum", m) === refWaysToSum(m), `n=${m}`);
  const coins = [...new Set(Array.from({ length: ri(1, 12) }, () => ri(1, m)))];
  check("Total Ways to Sum II", solvers.solve("Total Ways to Sum II", [m, coins]) === refWaysToSumII(m, coins), `${m},${coins}`);

  const rows = ri(1, 8), cols = ri(1, 8);
  const mat = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ri(1, 9)));
  check("Spiralize Matrix", JSON.stringify(solvers.solve("Spiralize Matrix", mat)) === JSON.stringify(refSpiral(mat)), JSON.stringify(mat));

  const jump = Array.from({ length: ri(3, 25) }, () => ri(0, 10));
  check("Array Jumping Game", solvers.solve("Array Jumping Game", jump) === refCanJump(jump), JSON.stringify(jump));
  check("Array Jumping Game II", solvers.solve("Array Jumping Game II", jump) === refMinJumps(jump), JSON.stringify(jump));

  const iv = Array.from({ length: ri(1, 20) }, () => { const a = ri(1, 50); return [a, a + ri(1, 20)]; });
  const merged = solvers.solve("Merge Overlapping Intervals", iv);
  const covered = new Set();
  for (const [a, b] of iv) for (let x = a; x <= b; x++) covered.add(x);
  const covered2 = new Set();
  for (const [a, b] of merged) for (let x = a; x <= b; x++) covered2.add(x);
  const sortedOk = merged.every((x, i) => i > 0 ? merged[i][0] > merged[i - 1][1] : true);
  check("Merge Overlapping Intervals", covered.size === covered2.size && sortedOk, JSON.stringify(iv));

  const digits = Array.from({ length: ri(4, 12) }, () => ri(0, 9)).join("");
  const ips = solvers.solve("Generate IP Addresses", digits);
  const refIps = refIP(digits);
  check("Generate IP Addresses", JSON.stringify([...ips].sort()) === JSON.stringify([...refIps].sort()), digits);

  const prices = Array.from({ length: ri(1, 25) }, () => ri(1, 100));
  check("Stock Trader I", solvers.solve("Algorithmic Stock Trader I", prices) === refMaxProfitDP(prices, 1), JSON.stringify(prices));
  check("Stock Trader II", solvers.solve("Algorithmic Stock Trader II", prices) === refMaxProfitDP(prices, prices.length), JSON.stringify(prices));
  check("Stock Trader III", solvers.solve("Algorithmic Stock Trader III", prices) === refMaxProfitDP(prices, 2), JSON.stringify(prices));
  const k = ri(1, 6);
  check("Stock Trader IV", solvers.solve("Algorithmic Stock Trader IV", [k, prices]) === refMaxProfitDP(prices, k), `${k},${JSON.stringify(prices)}`);

  const h = ri(1, 10);
  const tri = Array.from({ length: h }, (_, i) => Array.from({ length: i + 1 }, () => ri(1, 20)));
  check("Minimum Path Sum in a Triangle", solvers.solve("Minimum Path Sum in a Triangle", tri) === refTriangle(tri), JSON.stringify(tri));

  const R = ri(1, 8), C = ri(1, 8);
  check("Unique Paths in a Grid I", solvers.solve("Unique Paths in a Grid I", [R, C]) === refUniquePaths(Array.from({ length: R }, () => new Array(C).fill(0))), `${R}x${C}`);
  const g2 = Array.from({ length: R }, () => Array.from({ length: C }, () => (Math.random() < 0.2 ? 1 : 0)));
  g2[0][0] = 0; g2[R - 1][C - 1] = 0;
  check("Unique Paths in a Grid II", solvers.solve("Unique Paths in a Grid II", g2) === refUniquePaths(g2), JSON.stringify(g2));

  const g3 = Array.from({ length: R }, () => Array.from({ length: C }, () => (Math.random() < 0.25 ? 1 : 0)));
  g3[0][0] = 0; g3[R - 1][C - 1] = 0;
  const path = solvers.solve("Shortest Path in a Grid", g3);
  const optimal = refGridDist(g3);
  if (optimal === null) {
    check("Shortest Path in a Grid", path === "", `${JSON.stringify(g3)} got ${path}`);
  } else {
    let r = 0, c = 0, ok = true;
    for (const ch of path) {
      if (ch === "D") r++; else if (ch === "U") r--; else if (ch === "R") c++; else if (ch === "L") c--; else { ok = false; break; }
      if (r < 0 || r >= R || c < 0 || c >= C || g3[r][c] !== 0) { ok = false; break; }
    }
    check("Shortest Path in a Grid", ok && r === R - 1 && c === C - 1 && path.length === optimal, `${JSON.stringify(g3)} got ${path}`);
  }

  const parens = Array.from({ length: ri(1, 12) }, () => pick(["(", ")", "a"])).join("");
  const san = solvers.solve("Sanitize Parentheses in Expression", parens);
  const refSan = refSanitize(parens);
  check("Sanitize Parentheses in Expression", JSON.stringify([...san].sort()) === JSON.stringify([...refSan].sort()), `${parens} got ${JSON.stringify(san)}`);

  const numStr = String(ri(1, 9)) + Array.from({ length: ri(3, 9) }, () => ri(0, 9)).join("");
  const target = ri(-100, 100);
  const exprs = solvers.solve("Find All Valid Math Expressions", [numStr, target]);
  const refExprs = refMathExpressions(numStr, target);
  check("Find All Valid Math Expressions", JSON.stringify([...exprs].sort()) === JSON.stringify([...refExprs].sort()), `${numStr},${target}`);

  const x = ri(0, 2 ** 40);
  const enc = solvers.solve("HammingCodes: Integer to Encoded Binary", x);
  check("HammingCodes round-trip", solvers.solve("HammingCodes: Encoded Binary to Integer", enc) === x, `${x} -> ${enc}`);

  const V = ri(2, 12);
  const edges = [];
  for (let i = 0; i < V; i++) for (let j = i + 1; j < V; j++) if (Math.random() < 0.4) edges.push([i, j]);
  const color = solvers.solve("Proper 2-Coloring of a Graph", [V, edges]);
  if (!isBipartite(V, edges)) {
    check("Proper 2-Coloring", color.length === 0, `${V} ${JSON.stringify(edges)}`);
  } else {
    const ok = color.length === V && color.every((cc) => cc === 0 || cc === 1) && edges.every(([a, b]) => color[a] !== color[b]);
    check("Proper 2-Coloring", ok, `${V} ${JSON.stringify(edges)}`);
  }

  const rleSrc = Array.from({ length: ri(1, 40) }, () => pick(["a", "b", "c", "A", "B", "1", "2", "9"])).join("");
  const rle = solvers.solve("Compression I: RLE Compression", rleSrc);
  check("RLE round-trip", refRleDecode(rle) === rleSrc, `${rleSrc} -> ${rle}`);

  const lzSrc = Array.from({ length: ri(1, 60) }, () => pick(["A", "B", "C", "a", "b", "c", "1", "2", "3"])).join("");
  const lz = solvers.solve("Compression III: LZ Compression", lzSrc);
  check("LZ round-trip", solvers.solve("Compression II: LZ Decompression", lz) === lzSrc, `${lzSrc} -> ${lz}`);

  const shift = ri(1, 25);
  const plain = Array.from({ length: ri(1, 20) }, () => pick("ABCDEFGHIJKLMNOPQRSTUVWXYZ ".split(""))).join("");
  const caesar = solvers.solve("Encryption I: Caesar Cipher", [plain, shift]);
  const refCaesar = [...plain].map((c) => (c === " " ? " " : String.fromCharCode(((c.charCodeAt(0) - 65 - shift + 26) % 26) + 65))).join("");
  check("Caesar Cipher", caesar === refCaesar, `${plain},${shift}`);

  const key = Array.from({ length: ri(1, 9) }, () => pick("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""))).join("");
  const vig = solvers.solve("Encryption II: Vigenère Cipher", [plain, key]);
  const refVig = [...plain].map((c, i) => (c === " " ? " " : String.fromCharCode(((c.charCodeAt(0) - 2 * 65 + key.charCodeAt(i % key.length)) % 26) + 65))).join("");
  check("Vigenere Cipher", vig === refVig, `${plain},${key}`);

  const big = BigInt(Array.from({ length: ri(1, 200) }, () => ri(0, 9)).join("") || "1");
  const root = solvers.solve("Square Root", big);
  const s = refIsqrtFloor(big);
  const nearest = (big - s * s) <= ((s + 1n) * (s + 1n) - big) ? s : s + 1n;
  check("Square Root", root === nearest, `${big} -> ${root} (nearest ${nearest})`);

  const lo = ri(0, 200), hi = lo + ri(1, 400);
  let cnt = 0;
  for (let i = lo; i <= hi; i++) {
    if (i < 2) continue;
    let p = true;
    for (let d = 2; d * d <= i; d++) if (i % d === 0) { p = false; break; }
    if (p) cnt++;
  }
  check("Total Number of Primes", solvers.solve("Total Number of Primes", [lo, hi]) === cnt, `[${lo},${hi}]`);

  const gR = ri(4, 8), gC = ri(4, 8);
  const grid = Array.from({ length: gR }, () => Array.from({ length: gC }, () => (Math.random() < 0.15 ? 1 : 0)));
  if (grid.every((row) => row.every((v) => v === 1))) grid[0][0] = 0;
  const rect = solvers.solve("Largest Rectangle in a Matrix", grid);
  const area = (rect[1][0] - rect[0][0] + 1) * (rect[1][1] - rect[0][1] + 1);
  let allZeros = true;
  for (let r = rect[0][0]; r <= rect[1][0] && allZeros; r++)
    for (let c = rect[0][1]; c <= rect[1][1]; c++) if (grid[r][c] !== 0) { allZeros = false; break; }
  check("Largest Rectangle in a Matrix", area === refLargestZeroRectangle(grid) && allZeros, `${JSON.stringify(grid)} -> ${JSON.stringify(rect)}`);
}

console.log(`fuzz checks: ${checks}, failures: ${failures.length}`);
for (const f of failures.slice(0, 25)) console.log("  " + f);