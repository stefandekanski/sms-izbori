// Runs every *.test.js in this folder: deno run --allow-read web/test/run.js
import { run } from "./harness.js";

const dir = new URL(".", import.meta.url);
const files = [];
for await (const entry of Deno.readDir(dir)) {
  if (entry.isFile && entry.name.endsWith(".test.js")) files.push(entry.name);
}
files.sort();

let importFailures = 0;
for (const file of files) {
  try {
    await import(new URL(file, dir).href);
  } catch (error) {
    importFailures++;
    console.log(`LOAD FAIL ${file}\n  ${error?.message ?? error}`);
  }
}
await run({ importFailures });
