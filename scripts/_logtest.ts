/**
 * _logtest.ts - regression test for logger.ts.
 *
 * What it asserts:
 *   1. every module line lands in a text file, not the terminal
 *   2. the file name is one ns.write() actually accepts (.txt/.json/.css)
 *   3. the log is trimmed once it grows past LOG_LIMIT
 *   4. tail() reads back the newest entries
 *
 * Run with: node mocksuite.mjs _logtest --verbose
 */
import * as logger from "./logger.ts";

export async function main(ns: NS): Promise<void> {
  const file = logger.logFile(ns);

  // ns.write() only accepts .txt, .json and .css: "autobot.log" would throw
  // "File path should be a text file or script."
  if (!/\.(txt|json|css)$/i.test(file)) {
    throw new Error(`logger.logFile() produced an invalid path: ${file}`);
  }

  if (ns.read(file) !== "") throw new Error("the mock log file should start empty");

  logger.log(ns, "hello from the logger");
  logger.tlog(ns, "a milestone the player must see");

  const text = ns.read(file);
  if (!text.includes("hello from the logger")) throw new Error("logger.log() did not append to the file");
  if (!text.includes("a milestone")) throw new Error("logger.tlog() did not append to the file");
  if (!text.startsWith("[")) throw new Error("log lines must start with a timestamp");
  if (!text.includes(ns.getHostname())) throw new Error("log lines must name the server they came from");

  // Rotation: 700 long lines must not push the file past the limit.
  const filler = "x".repeat(90);
  for (let i = 0; i < 700; ++i) logger.log(ns, `line ${i} ${filler}`);

  const size = ns.read(file).length;
  if (size > logger.LOG_LIMIT + 200) {
    throw new Error(`log rotation failed: ${size} chars kept, limit is ${logger.LOG_LIMIT}`);
  }

  const last = logger.tail(ns, 3).split("\n").filter((l: string) => l.trim());
  if (last.length !== 3) throw new Error(`logger.tail() returned ${last.length} lines, expected 3`);
  if (!last[last.length - 1].includes("line 699")) throw new Error("logger.tail() must return the newest lines");

  logger.log(ns, `log test ok: ${file}, ${size} chars, tail works`);
}
