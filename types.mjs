const fs = require("fs");
const s = fs.readFileSync("ContractEnums.ts", "utf8");
const m = [...s.matchAll(/([A-Za-z]+) = "([^"]+)"/g)].map((x) => x[2]);
fs.writeFileSync("types.txt", m.join("\n"));
console.log(m.length);
