import { readFileSync, writeFileSync } from "node:fs";

let report = "";
try {
  const ts = await import("typescript");
  const T = ts.default ?? ts;
  const files = ["scripts/contracts.ts", "scripts/contractRunner.ts"];

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    report += `--- ${f} (${src.split("\n").length} lines) ---\n`;
    try {
      const sf = T.createSourceFile(f, src, T.ScriptTarget.ES2022, true, T.ScriptKind.TS);
      const diags = sf.diagnostics || [];
      report += diags.length ? diags.map((d) => `  line ${d.line + 1}: ${d.messageText}`).join("\n") : "  no syntax errors";
      report += "\n";
    } catch (e) {
      report += `  source-file error: ${e.message}\n`;
    }
    try {
      const res = T.transpileModule(src, { compilerOptions: { target: T.ScriptTarget.ES2022, module: T.ModuleKind.CommonJS } });
      report += `  transpiled to ${res.outputText.length} chars of JS\n`;
      new Function(res.outputText.replace(/^export /gm, ""));
      report += "  JS parse: OK\n\n";
    } catch (e) {
      report += `  JS parse FAILED: ${e.message}\n\n`;
    }
  }
} catch (e) {
  report += "FATAL: " + e.message + "\n";
}

writeFileSync("check_out.txt", report);


