function isqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function ref(n) {
  let r = 0n;
  let b = 1n << BigInt(Math.floor(n.toString(2).length / 2) + 1);
  while (b > 0n) {
    if ((r + b) * (r + b) <= n) r += b;
    b >>= 1n;
  }
  return r;
}

const tests = [0n, 1n, 2n, 3n, 4n, 10n, 99n, 100n, 1234567900987654321n, 1234567890123456721n, 10n ** 100n, 123456789012345678901234567890123456789n];
for (const v of tests) {
  const a = isqrt(v), b = ref(v);
  console.log(String(v), a, b, a === b ? "OK" : "MISMATCH");
}

// random bigints
for (let i = 0; i < 200; i++) {
  const n = (10n ** 200n) - BigInt(Math.floor(Math.random() * 1e18));
  const a = isqrt(n), b = ref(n);
  if (a !== b) { console.log("MISMATCH", String(n), a, b); break; }
}
console.log("random test done");
