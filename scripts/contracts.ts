/**
 * contracts.ts
 * ============================================================================
 * Solver library for every Bitburner coding-contract type.
 *
 * Every solver mirrors the official game implementation found in
 * src/codingContracts/ContractTypes.ts, so the values returned here are the
 * exact answers that ns.codingcontract.attempt() accepts.
 *
 * RAM cost: 0 GB. This file makes no ns API calls at all, so ns.dynamicImport()
 * (0 GB) is safe here. If you ever add an ns.* call to this file, change
 * contractRunner.ts to a static `import * as solvers from "./contracts.ts";` -
 * dynamically imported modules are invisible to Bitburner's static RAM pass and
 * the game would abort with "Dynamic RAM usage calculated to be greater than
 * RAM allocation".
 *
 * Usage:
 *   const solvers = await ns.dynamicImport("./contracts.ts");
 *   const answer  = solvers.solve(type, data);
 *   ns.codingcontract.attempt(answer, filename, host);
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Generic numeric helpers
// ---------------------------------------------------------------------------

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  if (n % 3 === 0) return n === 3;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/** Sieve of Eratosthenes - matches the game's "Total Number of Primes" solver. */
function countPrimes(low: number, high: number): number {
  if (low < 2) low = 2;
  const composite = new Uint8Array(high + 1);
  for (let i = 2; i * i <= high; ++i) {
    if (!composite[i]) {
      for (let j = i * i; j <= high; j += i) composite[j] = 1;
    }
  }
  let count = 0;
  for (let i = low; i <= high; ++i) {
    if (!composite[i]) ++count;
  }
  return count;
}

function largestPrimeFactor(n: number): number {
  let factor = 2;
  while (n > 1) {
    if (n % factor === 0) {
      n /= factor;
    } else {
      ++factor;
    }
  }
  return factor;
}

/** Kadane's algorithm - "Subarray with Maximum Sum". */
function maxSubarraySum(arr: number[]): number {
  let best = -Infinity;
  let current = 0;
  for (const value of arr) {
    current = Math.max(value, current + value);
    best = Math.max(best, current);
  }
  return best;
}

/** "Total Ways to Sum" - number of partitions of n (excluding n itself). */
function waysToSum(n: number): number {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (let k = 1; k < n; ++k) {
    for (let i = k; i <= n; ++i) dp[i] += dp[i - k];
  }
  return dp[n];
}

/** "Total Ways to Sum II" - partitions of n using only the given parts. */
function waysToSumII(n: number, parts: number[]): number {
  const dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const k of parts) {
    for (let i = k; i <= n; ++i) dp[i] += dp[i - k];
  }
  return dp[n];
}

/** "Spiralize Matrix" - clockwise spiral starting at top-left, going right. */
function spiralize(matrix: number[][]): number[] {
  const out: number[] = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;

  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; ++c) out.push(matrix[top][c]);
    ++top;
    for (let r = top; r <= bottom; ++r) out.push(matrix[r][right]);
    --right;
    if (top <= bottom) {
      for (let c = right; c >= left; --c) out.push(matrix[bottom][c]);
      --bottom;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; --r) out.push(matrix[r][left]);
      ++left;
    }
  }
  return out;
}

/** "Array Jumping Game" - returns 1 if the last index is reachable, else 0. */
function canJump(arr: number[]): number {
  let reach = 0;
  for (let i = 0; i < arr.length; ++i) {
    if (i > reach) return 0;
    reach = Math.max(reach, i + arr[i]);
  }
  return 1;
}

/** "Array Jumping Game II" - minimum number of jumps to reach the end. */
function minJumps(arr: number[]): number {
  const n = arr.length;
  const dp = new Array(n).fill(Infinity);
  dp[0] = 0;
  for (let i = 0; i < n; ++i) {
    if (dp[i] === Infinity) continue;
    for (let j = i + 1; j <= i + arr[i] && j < n; ++j) {
      dp[j] = Math.min(dp[j], dp[i] + 1);
    }
  }
  return dp[n - 1] === Infinity ? 0 : dp[n - 1];
}

/** "Merge Overlapping Intervals". */
function mergeIntervals(intervals: number[][]): number[][] {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (const interval of sorted) {
    const start = interval[0];
    const end = interval[1];
    if (out.length > 0 && start <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
}

/** "Generate IP Addresses" - every valid dotted-quad insertion. */
function ipAddresses(s: string): string[] {
  const out: string[] = [];
  const n = s.length;

  function validSegment(seg: string): boolean {
    if (seg.length > 3) return false;
    if (seg.length > 1 && seg[0] === "0") return false;
    return Number(seg) <= 255;
  }

  function rec(pos: number, count: number, path: string): void {
    if (count > 4) return;
    if (pos === n) {
      if (count === 4) out.push(path);
      return;
    }
    for (let len = 1; len <= 3 && pos + len <= n; ++len) {
      const seg = s.substring(pos, pos + len);
      if (!validSegment(seg)) break;
      rec(pos + len, count + 1, count === 0 ? seg : path + "." + seg);
    }
  }

  rec(0, 0, "");
  return out;
}

// ---------------------------------------------------------------------------
// Algorithmic Stock Trader I - IV
// ---------------------------------------------------------------------------

function stockTraderI(prices: number[]): number {
  let minPrice = prices[0];
  let best = 0;
  for (const price of prices) {
    minPrice = Math.min(minPrice, price);
    best = Math.max(best, price - minPrice);
  }
  return best;
}

function stockTraderII(prices: number[]): number {
  let profit = 0;
  for (let i = 1; i < prices.length; ++i) {
    profit += Math.max(prices[i] - prices[i - 1], 0);
  }
  return profit;
}

function stockTraderIII(prices: number[]): number {
  let hold1 = Number.MIN_SAFE_INTEGER;
  let hold2 = Number.MIN_SAFE_INTEGER;
  let release1 = 0;
  let release2 = 0;
  for (const price of prices) {
    release2 = Math.max(release2, hold2 + price);
    hold2 = Math.max(hold2, release1 - price);
    release1 = Math.max(release1, hold1 + price);
    hold1 = Math.max(hold1, price * -1);
  }
  return release2;
}

function stockTraderIV(k: number, prices: number[]): number {
  const len = prices.length;
  if (len < 2) return 0;
  if (k > len / 2) return stockTraderII(prices);

  const hold = new Array(k + 1).fill(Number.MIN_SAFE_INTEGER);
  const rele = new Array(k + 1).fill(0);

  for (const price of prices) {
    for (let i = 1; i <= k; ++i) {
      hold[i] = Math.max(hold[i], rele[i - 1] - price);
      rele[i] = Math.max(rele[i], hold[i] + price);
    }
  }
  return rele[k];
}

// ---------------------------------------------------------------------------
// Grid / triangle problems
// ---------------------------------------------------------------------------

/** "Minimum Path Sum in a Triangle". */
function minTrianglePath(triangle: number[][]): number {
  const dp = triangle[triangle.length - 1].slice();
  for (let row = triangle.length - 2; row >= 0; --row) {
    for (let col = 0; col < triangle[row].length; ++col) {
      dp[col] = triangle[row][col] + Math.min(dp[col], dp[col + 1]);
    }
  }
  return dp[0];
}

/** "Unique Paths in a Grid I" - exact combinatorics, safe for game-sized grids. */
function uniquePathsGrid(rows: number, cols: number): number {
  const dp = new Array(cols).fill(1);
  for (let r = 1; r < rows; ++r) {
    for (let c = 1; c < cols; ++c) dp[c] += dp[c - 1];
  }
  return dp[cols - 1];
}

/** "Unique Paths in a Grid II" - 1 is a wall, moves are right/down only. */
function uniquePathsBlocked(grid: number[][]): number {
  const rows = grid.length;
  const cols = grid[0].length;
  const dp: number[][] = [];
  for (let r = 0; r < rows; ++r) dp.push(new Array(cols).fill(0));

  for (let r = 0; r < rows; ++r) {
    for (let c = 0; c < cols; ++c) {
      if (grid[r][c] === 1) continue;
      if (r === 0 && c === 0) {
        dp[r][c] = 1;
      } else {
        dp[r][c] = (r > 0 ? dp[r - 1][c] : 0) + (c > 0 ? dp[r][c - 1] : 0);
      }
    }
  }
  return dp[rows - 1][cols - 1];
}

/**
 * "Shortest Path in a Grid" - BFS. The answer is a comma separated string of
 * "Right"/"Down" moves. The game accepts any valid path whose length is not
 * greater than the true shortest path.
 */
function shortestPathInGrid(grid: number[][]): string {
  const rows = grid.length;
  const cols = grid[0].length;
  const dist: number[][] = [];
  const parent: Array<Array<[number, number, string] | null>> = [];
  for (let r = 0; r < rows; ++r) {
    dist.push(new Array(cols).fill(-1));
    parent.push(new Array(cols).fill(null));
  }

  const queue: Array<[number, number]> = [[0, 0]];
  dist[0][0] = 0;

  while (queue.length > 0) {
    const cell = queue.shift() as [number, number];
    const r = cell[0];
    const c = cell[1];
    if (r === rows - 1 && c === cols - 1) break;

    const moves: Array<[number, number, string]> = [
      [r - 1, c, "U"],
      [r + 1, c, "D"],
      [r, c - 1, "L"],
      [r, c + 1, "R"],
    ];
    for (const [nr, nc, ch] of moves) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] === 1) continue;
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      parent[nr][nc] = [r, c, ch];
      queue.push([nr, nc]);
    }
  }

  if (dist[rows - 1][cols - 1] === -1) return "";

  const path: string[] = [];
  let r = rows - 1;
  let c = cols - 1;
  while (r !== 0 || c !== 0) {
    const p = parent[r][c];
    if (!p) break;
    path.push(p[2]);
    r = p[0];
    c = p[1];
  }
  return path.reverse().join("");
}

// ---------------------------------------------------------------------------
// Sanitize Parentheses in Expression
// ---------------------------------------------------------------------------

/**
 * "Sanitize Parentheses in Expression" - every distinct string that becomes
 * valid after removing the minimum possible number of parentheses.
 * This is the exact DFS used by the game (letters are preserved).
 */
function sanitizeParentheses(s: string): string[] {
  let left = 0; // number of "(" that must be removed
  let right = 0; // number of ")" that must be removed

  for (const ch of s) {
    if (ch === "(") {
      ++left;
    } else if (ch === ")") {
      if (left > 0) --left;
      else ++right;
    }
  }

  const res: string[] = [];

  function dfs(pair: number, index: number, l: number, r: number, solution: string): void {
    if (index === s.length) {
      if (l === 0 && r === 0 && pair === 0 && !res.includes(solution)) res.push(solution);
      return;
    }

    const ch = s[index];
    if (ch === "(") {
      // drop this "("
      if (l > 0) dfs(pair, index + 1, l - 1, r, solution);
      // keep it
      dfs(pair + 1, index + 1, l, r, solution + ch);
    } else if (ch === ")") {
      // drop this ")"
      if (r > 0) dfs(pair, index + 1, l, r - 1, solution);
      // keep it, only if it closes an open bracket
      if (pair > 0) dfs(pair - 1, index + 1, l, r, solution + ch);
    } else {
      dfs(pair, index + 1, l, r, solution + ch);
    }
  }

  dfs(0, 0, left, right, "");
  return res;
}

// ---------------------------------------------------------------------------
// Find All Valid Math Expressions
// ---------------------------------------------------------------------------

function mathExpressions(digits: string, target: number): string[] {
  const result: string[] = [];

  function rec(path: string, pos: number, evaluated: number, multed: number): void {
    if (pos === digits.length) {
      if (evaluated === target) result.push(path);
      return;
    }
    for (let i = pos; i < digits.length; ++i) {
      if (i !== pos && digits[pos] === "0") break;
      const cur = parseInt(digits.substring(pos, i + 1), 10);
      if (pos === 0) {
        rec(path + cur, i + 1, cur, cur);
      } else {
        rec(path + "+" + cur, i + 1, evaluated + cur, cur);
        rec(path + "-" + cur, i + 1, evaluated - cur, -cur);
        rec(path + "*" + cur, i + 1, evaluated - multed + multed * cur, multed * cur);
      }
    }
  }

  rec("", 0, 0, 0);
  return result;
}

// ---------------------------------------------------------------------------
// HammingCodes
// ---------------------------------------------------------------------------

/**
 * "HammingCodes: Integer to Encoded Binary".
 * Reproduces the game's HammingEncode() exactly: 7-2 Hamming code with an
 * overall even-parity bit at position 0.
 */
function hammingEncode(data: number): string {
  const enc = [0];
  const bits = data
    .toString(2)
    .split("")
    .reverse()
    .map((v) => parseInt(v, 10));
  let k = bits.length;

  for (let i = 1; k > 0; ++i) {
    if ((i & (i - 1)) !== 0) enc[i] = bits[--k];
    else enc[i] = 0;
  }

  let parityNumber = 0;
  for (let i = 0; i < enc.length; ++i) {
    if (enc[i]) parityNumber ^= i;
  }
  const parityArray = parityNumber
    .toString(2)
    .split("")
    .reverse()
    .map((v) => parseInt(v, 10));
  for (let i = 0; i < parityArray.length; ++i) {
    enc[2 ** i] = parityArray[i] ? 1 : 0;
  }

  parityNumber = 0;
  for (let i = 0; i < enc.length; ++i) {
    if (enc[i]) ++parityNumber;
  }
  enc[0] = parityNumber % 2 === 0 ? 0 : 1;

  return enc.join("");
}

/**
 * "HammingCodes: Encoded Binary to Integer".
 * Reproduces the game's HammingDecode(): correct a single bit, then read the
 * data bits back out.
 */
function hammingDecode(encoded: string): number {
  const bits: number[] = [];
  let err = 0;

  /* XOR of every index holding a 1 spells out the position of the flipped bit */
  for (let i = 0; i < encoded.length; ++i) {
    const bit = parseInt(encoded[i], 10);
    bits[i] = bit;
    if (bit) err ^= i;
  }

  if (err) bits[err] = bits[err] ? 0 : 1;

  /* Bit 0 is the overall parity bit; indices that are powers of two are the
   * Hamming parity bits. Everything else is data, read most-significant first. */
  let answer = "";
  for (let i = 1; i < bits.length; ++i) {
    if ((i & (i - 1)) !== 0) answer += bits[i];
  }

  return parseInt(answer, 2);
}

// ---------------------------------------------------------------------------
// Proper 2-Coloring of a Graph
// ---------------------------------------------------------------------------

/**
 * "Proper 2-Coloring of a Graph" - BFS bipartite colouring. The game only
 * checks that no two connected vertices share a colour, so any valid
 * 0/1 assignment is accepted.
 */
function twoColorGraph(n: number, edges: number[][]): number[] {
  const adjacency: number[][] = [];
  for (let i = 0; i < n; ++i) adjacency.push([]);
  for (const edge of edges) {
    adjacency[edge[0]].push(edge[1]);
    adjacency[edge[1]].push(edge[0]);
  }

  const colors = new Array(n).fill(-1);
  for (let start = 0; start < n; ++start) {
    if (colors[start] !== -1) continue;
    colors[start] = 0;
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift() as number;
      for (const next of adjacency[node]) {
        if (colors[next] === -1) {
          colors[next] = 1 - colors[node];
          queue.push(next);
        } else if (colors[next] === colors[node]) {
          return []; // odd cycle: no proper 2-coloring exists
        }
      }
    }
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Compression I: RLE Compression
// ---------------------------------------------------------------------------

/** Run-length encoding, matching the game's rleEncode(). */
function rleEncode(plain: string): string {
  if (plain.length === 0) return "";
  let out = "";
  let count = 1;
  for (let i = 1; i < plain.length; ++i) {
    if (count < 9 && plain[i] === plain[i - 1]) {
      ++count;
    } else {
      out += String(count) + plain[i - 1];
      count = 1;
    }
  }
  out += String(count) + plain[plain.length - 1];
  return out;
}

// ---------------------------------------------------------------------------
// Compression II / III: LZ
// ---------------------------------------------------------------------------

/** LZ decompression - identical to the game's comprLZDecode(). */
function lzDecode(compr: string): string | null {
  let plain = "";

  for (let i = 0; i < compr.length; ) {
    const literalLength = compr.charCodeAt(i) - 0x30;
    if (literalLength < 0 || literalLength > 9 || i + 1 + literalLength > compr.length) {
      return null;
    }

    plain += compr.substring(i + 1, i + 1 + literalLength);
    i += 1 + literalLength;

    if (i >= compr.length) break;

    const backrefLength = compr.charCodeAt(i) - 0x30;
    if (backrefLength < 0 || backrefLength > 9) {
      return null;
    } else if (backrefLength === 0) {
      ++i;
    } else {
      if (i + 1 >= compr.length) return null;
      const backrefOffset = compr.charCodeAt(i + 1) - 0x30;
      if (
        (backrefLength > 0 && (backrefOffset < 1 || backrefOffset > 9)) ||
        backrefOffset > plain.length
      ) {
        return null;
      }
      for (let j = 0; j < backrefLength; ++j) {
        plain += plain[plain.length - backrefOffset];
      }
      i += 2;
    }
  }

  return plain;
}

/**
 * LZ compression - the same dynamic-programming encoder the game uses, so our
 * output is never longer than the accepted answer.
 */
function lzEncode(plain: string): string {
  // state[i][j]: i === 0 -> literal of length j, else backreference (offset i, length j)
  let curState: (string | null)[][] = Array.from(Array(10), () => Array<string | null>(10).fill(null));
  let newState: (string | null)[][] = Array.from(Array(10), () => Array<string | null>(10).fill(null));

  function set(state: (string | null)[][], i: number, j: number, str: string): void {
    const current = state[i][j];
    if (current === null || str.length < current.length) state[i][j] = str;
  }

  curState[0][1] = "";

  for (let i = 1; i < plain.length; ++i) {
    for (const row of newState) row.fill(null);
    const c = plain[i];

    // Handle literals
    for (let length = 1; length <= 9; ++length) {
      const str = curState[0][length];
      if (str === null) continue;

      if (length < 9) {
        set(newState, 0, length + 1, str);
      } else {
        set(newState, 0, 1, str + "9" + plain.substring(i - 9, i) + "0");
      }

      for (let offset = 1; offset <= Math.min(9, i); ++offset) {
        if (plain[i - offset] === c) {
          set(newState, offset, 1, str + String(length) + plain.substring(i - length, i));
        }
      }
    }

    // Handle backreferences
    for (let offset = 1; offset <= 9; ++offset) {
      for (let length = 1; length <= 9; ++length) {
        const str = curState[offset][length];
        if (str === null) continue;

        if (plain[i - offset] === c) {
          if (length < 9) set(newState, offset, length + 1, str);
          else set(newState, offset, 1, str + "9" + String(offset) + "0");
        }

        // End this backreference and start a literal
        set(newState, 0, 1, str + String(length) + String(offset));

        // End this backreference and start another one
        for (let newOffset = 1; newOffset <= Math.min(9, i); ++newOffset) {
          if (plain[i - newOffset] === c) {
            set(newState, newOffset, 1, str + String(length) + String(offset) + "0");
          }
        }
      }
    }

    const tmp = newState;
    newState = curState;
    curState = tmp;
  }

  let result: string | null = null;

  for (let len = 1; len <= 9; ++len) {
    const str = curState[0][len];
    if (str === null) continue;
    const candidate = str + String(len) + plain.substring(plain.length - len, plain.length);
    if (result === null || candidate.length < result.length) result = candidate;
  }

  for (let offset = 1; offset <= 9; ++offset) {
    for (let len = 1; len <= 9; ++len) {
      const str = curState[offset][len];
      if (str === null) continue;
      const candidate = str + String(len) + String(offset);
      if (result === null || candidate.length < result.length) result = candidate;
    }
  }

  return result ?? "";
}

// ---------------------------------------------------------------------------
// Encryption I / II
// ---------------------------------------------------------------------------

function caesarCipher(plaintext: string, shift: number): string {
  return [...plaintext]
    .map((a) =>
      a === " " ? a : String.fromCharCode(((a.charCodeAt(0) - 65 - shift + 26) % 26) + 65),
    )
    .join("");
}

function vigenereCipher(plaintext: string, keyword: string): string {
  return [...plaintext]
    .map((a, i) =>
      a === " "
        ? a
        : String.fromCharCode(
            ((a.charCodeAt(0) - 2 * 65 + keyword.charCodeAt(i % keyword.length)) % 26) + 65,
          ),
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Square Root (BigInt)
// ---------------------------------------------------------------------------

/** Floor square root of a BigInt (Newton's method). */
function isqrtBig(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Nearest integer square root - what the "Square Root" contract expects. */
function squareRoot(n: bigint): bigint {
  const s = isqrtBig(n);
  const up = (s + 1n) * (s + 1n) - n;
  const down = n - s * s;
  return up <= down ? s + 1n : s;
}

// ---------------------------------------------------------------------------
// Largest Rectangle in a Matrix
// ---------------------------------------------------------------------------

function largestRectangle(grid: number[][]): number[][] {
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  const histograms: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let c = 0; c < cols; ++c) {
    let count = 0;
    for (let r = 0; r < rows; ++r) {
      if ((grid[r][c] ?? 0) === 0) ++count;
      else count = 0;
      histograms[r][c] = count;
    }
  }

  let maxArea = 0;
  let maxL = 0;
  let maxR = 0;
  let maxU = 0;
  let maxD = 0;

  for (let i = 0; i < histograms.length; ++i) {
    const row = histograms[i];
    for (let j = 0; j < row.length; ++j) {
      if (row[j] === 0) continue;
      let left = j;
      let right = j;
      while (row[left - 1] >= row[j]) --left;
      while (row[right + 1] >= row[j]) ++right;
      const area = (right - left + 1) * row[j];
      if (area > maxArea) {
        maxArea = area;
        maxL = left;
        maxR = right;
        maxU = i - row[j] + 1;
        maxD = i;
      }
    }
  }

  return [
    [maxU, maxL],
    [maxD, maxR],
  ];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Every contract type that exists in the game (mirrors CodingContractName). */
export const CONTRACT_TYPES: string[] = [
  "Find Largest Prime Factor",
  "Subarray with Maximum Sum",
  "Total Ways to Sum",
  "Total Ways to Sum II",
  "Spiralize Matrix",
  "Array Jumping Game",
  "Array Jumping Game II",
  "Merge Overlapping Intervals",
  "Generate IP Addresses",
  "Algorithmic Stock Trader I",
  "Algorithmic Stock Trader II",
  "Algorithmic Stock Trader III",
  "Algorithmic Stock Trader IV",
  "Minimum Path Sum in a Triangle",
  "Unique Paths in a Grid I",
  "Unique Paths in a Grid II",
  "Shortest Path in a Grid",
  "Sanitize Parentheses in Expression",
  "Find All Valid Math Expressions",
  "HammingCodes: Integer to Encoded Binary",
  "HammingCodes: Encoded Binary to Integer",
  "Proper 2-Coloring of a Graph",
  "Compression I: RLE Compression",
  "Compression II: LZ Decompression",
  "Compression III: LZ Compression",
  "Encryption I: Caesar Cipher",
  "Encryption II: Vigenère Cipher",
  "Square Root",
  "Total Number of Primes",
  "Largest Rectangle in a Matrix",
];

/**
 * Normalise a contract name so accents/punctuation never matter.
 * "Encryption II: Vigenere Cipher" -> "encryptioniivigenrecipher"
 */
function normalize(type: string): string {
  return type
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Solve a coding contract. Returns the exact value ns.codingcontract.attempt()
 * expects, or null for an unknown contract type.
 */
export function solve(type: string, data: unknown): unknown {
  const key = normalize(type);

  switch (key) {
    case "findlargestprimefactor":
      return largestPrimeFactor(Number(data));
    case "subarraywithmaximumsum":
      return maxSubarraySum(data as number[]);
    case "totalwaystosum":
      return waysToSum(Number(data));
    case "totalwaystosumii": {
      const [n, parts] = data as [number, number[]];
      return waysToSumII(n, parts);
    }
    case "spiralizematrix":
      return spiralize(data as number[][]);
    case "arrayjumpinggame":
      return canJump(data as number[]);
    case "arrayjumpinggameii":
      return minJumps(data as number[]);
    case "mergeoverlappingintervals":
      return mergeIntervals(data as number[][]);
    case "generateipaddresses":
      return ipAddresses(String(data));
    case "algorithmicstocktraderi":
      return stockTraderI(data as number[]);
    case "algorithmicstocktraderii":
      return stockTraderII(data as number[]);
    case "algorithmicstocktraderiii":
      return stockTraderIII(data as number[]);
    case "algorithmicstocktraderiv": {
      const [k, prices] = data as [number, number[]];
      return stockTraderIV(k, prices);
    }
    case "minimumpathsuminatriangle":
      return minTrianglePath(data as number[][]);
    case "uniquepathsinagridi": {
      const [rows, cols] = data as [number, number];
      return uniquePathsGrid(rows, cols);
    }
    case "uniquepathsinagridii":
      return uniquePathsBlocked(data as number[][]);
    case "shortestpathinagrid":
      return shortestPathInGrid(data as number[][]);
    case "sanitizeparenthesesinexpression":
      return sanitizeParentheses(String(data));
    case "findallvalidmathexpressions": {
      const [digits, target] = data as [string, number];
      return mathExpressions(digits, target);
    }
    case "hammingcodesintegertoencodedbinary":
      return hammingEncode(Number(data));
    case "hammingcodesencodedbinarytointeger":
      return hammingDecode(String(data));
    case "proper2coloringofagraph": {
      const [n, edges] = data as [number, number[][]];
      return twoColorGraph(n, edges);
    }
    case "compressionirlecompression":
      return rleEncode(String(data));
    case "compressioniilzdecompression":
      return lzDecode(String(data)) ?? "";
    case "compressioniiilzcompression":
      return lzEncode(String(data));
    case "encryptionicaesarcipher": {
      const [plaintext, shift] = data as [string, number];
      return caesarCipher(plaintext, shift);
    }
    case "encryptioniivigenrecipher":
    case "encryptioniivigenerecipher": {
      const [plaintext, keyword] = data as [string, string];
      return vigenereCipher(plaintext, keyword);
    }
    case "squareroot":
      return squareRoot(BigInt(data as bigint));
    case "totalnumberofprimes": {
      const [low, high] = data as [number, number];
      return countPrimes(low, high);
    }
    case "largestrectangleinamatrix":
      return largestRectangle(data as number[][]);
    default:
      return null;
  }
}

/** Every contract type this library can solve. */
export function supportedTypes(): string[] {
  return [
    "Find Largest Prime Factor",
    "Subarray with Maximum Sum",
    "Total Ways to Sum",
    "Total Ways to Sum II",
    "Spiralize Matrix",
    "Array Jumping Game",
    "Array Jumping Game II",
    "Merge Overlapping Intervals",
    "Generate IP Addresses",
    "Algorithmic Stock Trader I",
    "Algorithmic Stock Trader II",
    "Algorithmic Stock Trader III",
    "Algorithmic Stock Trader IV",
    "Minimum Path Sum in a Triangle",
    "Unique Paths in a Grid I",
    "Unique Paths in a Grid II",
    "Shortest Path in a Grid",
    "Sanitize Parentheses in Expression",
    "Find All Valid Math Expressions",
    "HammingCodes: Integer to Encoded Binary",
    "HammingCodes: Encoded Binary to Integer",
    "Proper 2-Coloring of a Graph",
    "Compression I: RLE Compression",
    "Compression II: LZ Decompression",
    "Compression III: LZ Compression",
    "Encryption I: Caesar Cipher",
    "Encryption II: Vigenère Cipher",
    "Square Root",
    "Total Number of Primes",
    "Largest Rectangle in a Matrix",
  ];
}

/**
 * Self-test using the examples published in the contract descriptions.
 * Returns an array of failure messages - an empty array means everything passed.
 * Run it from the terminal with:  node -e ...  or from a scratch script.
 */
export function selfTest(): string[] {
  const failures: string[] = [];
  const cases: Array<[string, unknown, unknown]> = [
    ["Find Largest Prime Factor", 60, 5],
    ["Subarray with Maximum Sum", [-1, 2, 3, 4, -5, 8], 12],
    ["Total Ways to Sum", 8, 21],
    ["Total Ways to Sum II", [10, [2, 3, 5]], 4],
    ["Spiralize Matrix", [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 2, 3, 6, 9, 8, 7, 4, 5]],
    ["Array Jumping Game", [2, 3, 1, 1, 4], 1],
    ["Array Jumping Game II", [2, 3, 1, 1, 4], 2],
    [
      "Merge Overlapping Intervals",
      [[1, 3], [2, 6], [8, 10], [15, 18]],
      [[1, 6], [8, 10], [15, 18]],
    ],
    ["Generate IP Addresses", "1234", ["1.2.3.4"]],
    ["Algorithmic Stock Trader I", [1, 2, 3, 4, 5], 4],
    ["Algorithmic Stock Trader II", [1, 5, 3, 7], 8],
    ["Algorithmic Stock Trader III", [4, 2, 2, 2, 5], 3],
    ["Algorithmic Stock Trader IV", [2, [1, 2, 3, 4, 5]], 4],
    ["Minimum Path Sum in a Triangle", [[1], [2, 3], [4, 5, 6]], 7],
    ["Unique Paths in a Grid I", [3, 4], 10],
    ["Unique Paths in a Grid II", [[0, 0, 0], [0, 1, 0], [0, 0, 0]], 2],
    ["Shortest Path in a Grid", [[0, 0, 0], [0, 1, 0], [0, 0, 0]], "DDRR"], // any 4-move path is accepted
    ["Sanitize Parentheses in Expression", "(()", ["()"]],
    ["Find All Valid Math Expressions", ["123", 6], ["1+2+3", "1*2*3"]],
    ["HammingCodes: Integer to Encoded Binary", 8, "11110000"],
    ["HammingCodes: Integer to Encoded Binary", 21, "1001101011"],
    ["HammingCodes: Encoded Binary to Integer", "11110000", 8],
    ["Proper 2-Coloring of a Graph", [4, [[0, 1], [1, 2], [2, 3], [3, 0]]], [0, 1, 0, 1]],
    ["Compression I: RLE Compression", "aaaaabccc", "5a1b3c"],
    ["Compression II: LZ Decompression", "1A11", "AA"],
    ["Encryption I: Caesar Cipher", ["HELLO WORLD", 3], "EBIIL TLOIA"],
    ["Encryption II: Vigenère Cipher", ["DASHBOARD", "LINUX"], "OIFBYZIEX"],
    ["Square Root", 10n, 3n],
    ["Total Number of Primes", [10, 30], 6],
    ["Largest Rectangle in a Matrix", [[0, 0, 0], [0, 0, 0], [1, 1, 1]], [[0, 0], [1, 2]]],
  ];

  for (const [type, data, expected] of cases) {
    const got = solve(type, data);
    const gotStr = typeof got === "bigint" ? got.toString() : JSON.stringify(got);
    const expStr = typeof expected === "bigint" ? expected.toString() : JSON.stringify(expected);
    if (gotStr !== expStr) {
      failures.push(`${type}: expected ${expStr}, got ${gotStr}`);
    }
  }

  // Compression III must round-trip through the Compression II decompressor.
  const lzSample = "aaaaaaaaaaabbbcccabcabcabcabc";
  const lzEncoded = solve("Compression III: LZ Compression", lzSample) as string;
  const lzBack = solve("Compression II: LZ Decompression", lzEncoded) as string;
  if (lzBack !== lzSample) {
    failures.push(`Compression III: LZ Compression round-trip failed: "${lzEncoded}" -> "${lzBack}"`);
  }
  if (lzEncoded.length >= lzSample.length) {
    failures.push(`Compression III: LZ Compression is not shorter than input (${lzEncoded.length} >= ${lzSample.length})`);
  }

  // LZ round-trip check
  const sample = "ABABABABABABABABABCCCCCABABABABABABABABAB";
  const encoded = lzEncode(sample);
  if (lzDecode(encoded) !== sample) failures.push("LZ round-trip failed");
  if (encoded.length >= sample.length) failures.push("LZ encoding is not shorter than input");

  return failures;
}






