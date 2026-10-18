/**
 * stanek_check.mjs - validate the Stanek packing produced by scripts/stanek.ts
 * against the mock ns. Run with: node stanek_check.mjs
 */
import { makeNs, runModule } from "./mocksuite.mjs";

const opts = {
  modules: ["stanek.ts"],
  loops: 1,
  bitnode: 13,
  ram: 1024,
  verbose: false,
  sourceFiles: new Map([[2, 1], [3, 1], [4, 1], [6, 1], [8, 1], [9, 1], [10, 1], [13, 3], [14, 1], [15, 1]]),
};

const ns = makeNs(["--loops", "1"], "home", opts);
await runModule("stanek.ts", ns, false);

const w = ns.stanek.giftWidth();
const h = ns.stanek.giftHeight();
const frags = ns.stanek.activeFragments();

const grid = Array.from({ length: h }, () => Array(w).fill("."));
let bad = 0;

for (const f of frags) {
  const rows = f.shape.length;
  const cols = f.shape[0].length;
  const bw = f.rotation % 2 === 0 ? cols : rows;
  const bh = f.rotation % 2 === 0 ? rows : cols;
  if (f.x + bw > w || f.y + bh > h) {
    console.log(`OUT OF BOUNDS: fragment ${f.id} at ${f.x},${f.y} rot ${f.rotation} box ${bw}x${bh}`);
    bad++;
  }
  for (let r = 0; r < rows; ++r) {
    for (let c = 0; c < cols; ++c) {
      if (!f.shape[r][c]) continue;
      let rr, cc;
      if (f.rotation === 0) { rr = r; cc = c; }
      else if (f.rotation === 1) { rr = c; cc = rows - 1 - r; }
      else if (f.rotation === 2) { rr = rows - 1 - r; cc = cols - 1 - c; }
      else { rr = cols - 1 - c; cc = rows - 1 - r; }
      const x = f.x + cc, y = f.y + rr;
      if (x < 0 || y < 0 || x >= w || y >= h) { console.log(`OUT OF BOUNDS cell ${x},${y} of fragment ${f.id}`); bad++; continue; }
      if (grid[y][x] !== ".") { console.log(`OVERLAP at ${x},${y}: fragments ${f.id} and ${grid[y][x]}`); bad++; }
      grid[y][x] = String(f.id);
    }
  }
}

console.log(`gift ${w}x${h}, ${frags.length} fragments, ${bad} problems`);
for (const row of grid) console.log(row.join(" "));
const filled = grid.flat().filter((c) => c !== ".").length;
console.log(`coverage: ${filled}/${w * h} cells, total power ${frags.reduce((a, f) => a + f.power, 0)}`);