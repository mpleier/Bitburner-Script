// Cross-check the solvers in contracts.ts against the *official* game
// implementations copied verbatim from the Bitburner source tree.
import { solve } from "./contracts.ts";

/* ---------------- official HammingEncode / HammingDecode ---------------- */
function refHammingEncode(data) {
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
}

function refHammingDecode(data) {
  let err = 0;
  const bits = [];
  const arr = data.split("");
  for (let i = 0; i < arr.length; ++i) {
    const bit = parseInt(arr[i]);
    bits[i] = bit;
    if (bit) err ^= +i;
  }
  if (err) bits[err] = bits[err] ? 0 : 1;
  let ans = "";
  for (let i = 1; i < bits.length; i++) if ((i & (i - 1)) != 0) ans += bits[i];
  return parseInt(ans, 2);
}

/* ---------------- official largest-rectangle answer ---------------- */
function refLargestRectangle(data) {
  const histograms = Array.from({ length: data.length }, () => Array(data[0].length).fill(0));
  for (let i = 0; i < data[0].length; i++) {
    let count = 0;
    for (let j = 0; j < data.length; j++) {
      if (data[j][i] == 0) count++;
      else count = 0;
      histograms[j][i] = count;
    }
  }
  let maxArea = 0, maxL = 0, maxR = 0, maxU = 0, maxD = 0;
  for (let i = 0; i < histograms.length; i++) {
    const row = histograms[i];
    for (let j = 0; j < row.length; j++) {
      if (row[j] == 0) continue;
      let left = j, right = j;
      while (row[left - 1] >= row[j]) left--;
      while (row[right + 1] >= row[j]) right++;
      if ((right - left + 1) * row[j] > maxArea) {
        maxArea = (right - left + 1) * row[j];
        maxL = left; maxR = right; maxU = i - row[j] + 1; maxD = i;
      }
    }
  }
  return [[maxU, maxL], [maxD, maxR]];
}

/* ---------------- official sanitize-parentheses answer ---------------- */
function refSanitize(data) {
  let left = 0, right = 0;
  const res = [];
  for (let i = 0; i < data.length; ++i) {
    if (data[i] === "(") ++left;
    else if (data[i] === ")") left > 0 ? --left : ++right;
  }
  function dfs(pair, index, l, r, s, solution) {
    if (s.length === index) {
      if (l === 0 && r === 0 && pair === 0) {
        for (let i = 0; i < res.length; i++) if (res[i] === solution) return;
        res.push(solution);
      }
      return;
    }
    if (s[index] === "(") {
      if (l > 0) dfs(pair, index + 1, l - 1, r, s, solution);
      dfs(pair + 1, index + 1, l, r, s, solution + s[index]);
    } else if (s[index] === ")") {
      if (r > 0) dfs(pair, index + 1, l, r - 1, s, solution);
      if (pair > 0) dfs(pair - 1, index + 1, l, r, s, solution + s[index]);
    } else {
      dfs(pair, index + 1, l, r, s, solution + s[index]);
    }
  }
  dfs(0, 0, left, right, data, "");
  return res;
}

/* ---------------- randomised comparison ---------------- */
let bad = 0;
function check(name, mine, ref) {
  const a = JSON.stringify(mine), b = JSON.stringify(ref);
  if (a !== b) { console.log(`MISMATCH ${name}: mine=${a} ref=${b}`); bad++; }
}

for (let t = 0; t < 300; ++t) {
  const n = Math.floor(Math.random() * 1e15) + 1;
  check(`hammingEncode(${n})`, solve("HammingCodes: Integer to Encoded Binary", n), refHammingEncode(n));
  const enc = refHammingEncode(n);
  const flipped = enc.split("");
  if (t % 2 === 0) flipped[Math.floor(Math.random() * flipped.length)] = flipped[Math.floor(Math.random() * flipped.length)] === "0" ? "1" : "0";
  check(`hammingDecode(${enc})`, solve("HammingCodes: Encoded Binary to Integer", enc), refHammingDecode(enc));
  check(`hammingDecode(flipped)`, solve("HammingCodes: Encoded Binary to Integer", flipped.join("")), refHammingDecode(flipped.join("")));

  const rows = 4 + Math.floor(Math.random() * 10);
  const cols = 4 + Math.floor(Math.random() * 10);
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (Math.random() < 0.15 ? 1 : 0)));
  check("largestRectangle", solve("Largest Rectangle in a Matrix", grid), refLargestRectangle(grid));

  const len = 6 + Math.floor(Math.random() * 12);
  const parens = Array.from({ length: len }, () => (Math.random() < 0.4 ? "(" : Math.random() < 0.8 ? ")" : "a")).join("");
  const mine = solve("Sanitize Parentheses in Expression", parens).slice().sort();
  const ref = refSanitize(parens).slice().sort();
  check(`sanitize(${parens})`, mine, ref);
}

console.log(bad === 0 ? "Cross-check vs official implementations: OK" : `${bad} mismatches`);
console.log("Hamming encode examples:", solve("HammingCodes: Integer to Encoded Binary", 8), solve("HammingCodes: Integer to Encoded Binary", 21));
console.log("Hamming decode examples:", solve("HammingCodes: Encoded Binary to Integer", "11110000"), solve("HammingCodes: Encoded Binary to Integer", "1001101010"));
