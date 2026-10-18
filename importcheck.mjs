/**
 * importcheck.mjs
 * ============================================================================
 * Reproduce Bitburner's in-game module pipeline locally:
 *   1. transformScript()  -> SWC (src/utils/ScriptTransformer.ts)
 *   2. acorn parse + walk -> every remaining ImportDeclaration must resolve
 *      to a script that exists ON THE SAME SERVER
 *      (src/NetscriptJSEvaluator.ts -> getModuleScript)
 *
 * Anything left over is exactly what makes the game throw
 * "Module not found" / "Invalid module path".
 *
 * Run: node importcheck.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const swc = require("@swc/core");
const acorn = require("acorn");
const walk = require("acorn-walk");

const SCRIPTS = path.join(process.cwd(), "scripts");
const validScriptExtensions = [".js", ".ts", ".jsx", ".tsx", ".script"];

/** Local Node harnesses that are never uploaded to the game. */
const HARNESSES = new Set(["debug.mjs", "selftest.mjs", "verify.mjs"]);

/** Mirrors resolveScriptFilePath() well enough for a local audit. */
function resolvePath(spec, baseFile) {
  const baseDir = path.dirname(baseFile);
  if (spec.startsWith("/")) return path.normalize(path.join(SCRIPTS, spec));
  const joined = path.normalize(path.join(baseDir, spec));
  if (!joined.startsWith(SCRIPTS)) return null; // escapes the scripts root
  return joined;
}

function fileTypeOf(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return ["txt", "json", "js", "jsx", "ts", "tsx", "script", "css"].includes(ext) ? ext : null;
}

let problems = 0;

for (const file of fs.readdirSync(SCRIPTS)) {
  if (HARNESSES.has(file)) continue;
  const full = path.join(SCRIPTS, file);
  let code;
  try {
    code = swc.transformSync(fs.readFileSync(full, "utf8"), {
      jsc: { parser: { syntax: "typescript" }, target: "esnext" },
    }).code;
  } catch (err) {
    console.log(`${file}: SWC transform failed -> ${err.message}`);
    problems++;
    continue;
  }

  const ast = acorn.parse(code, { sourceType: "module", ecmaVersion: "latest" });
  const imports = [];
  walk.simple(ast, {
    ImportDeclaration: (n) => imports.push(n.source.value),
    ExportNamedDeclaration: (n) => { if (n.source) imports.push(n.source.value); },
    ExportAllDeclaration: (n) => { if (n.source) imports.push(n.source.value); },
  });

  if (imports.length === 0) {
    console.log(`${file.padEnd(20)} no runtime imports (type-only imports were erased)`);
    continue;
  }

  for (const spec of imports) {
    const ext = fileTypeOf(spec);
    const resolved = resolvePath(spec, full);
    const ok = ext !== null && resolved && fs.existsSync(resolved);
    console.log(
      `${file.padEnd(20)} runtime import "${spec}" -> ${
        ok ? "resolves (legal, but costs RAM)" : "MODULE NOT FOUND / INVALID PATH"
      }`,
    );
    if (!ok) problems++;
  }
}

console.log(`\n${problems === 0 ? "OK" : `${problems} import problem(s)`}`);
process.exitCode = problems ? 1 : 0;
