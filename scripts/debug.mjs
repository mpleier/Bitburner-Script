const c = new Uint8Array(31);
for (let i = 2; i * i <= 30; ++i) {
  if (!c[i]) {
    for (let j = i * i; j <= 30; ++j) c[j] = 1;
  }
}
let n = 0;
for (let i = 10; i <= 30; ++i) if (!c[i]) n++;
console.log("manual sieve count:", n);
console.log("composite array:", Array.from(c).join(","));
