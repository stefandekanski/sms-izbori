// A tiny test runner, so tests run with plain `deno run` and need nothing installed.

const tests = [];

/** Registers a test; `fn` may be async. */
export function test(name, fn) {
  tests.push({ name, fn });
}

/** Runs every registered test, prints each failure and a summary, and exits with 1 if any failed. */
export async function run({ importFailures = 0 } = {}) {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
    } catch (error) {
      failed++;
      console.log(`FAIL ${t.name}\n  ${String(error?.message ?? error).replaceAll("\n", "\n  ")}`);
    }
  }
  console.log(`${tests.length - failed} passed, ${failed} failed, ${importFailures} files could not load`);
  if (failed > 0 || importFailures > 0) Deno.exit(1);
}
