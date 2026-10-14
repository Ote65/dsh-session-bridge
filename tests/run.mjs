/**
 * Runs both suites and exits non-zero when anything fails.
 *
 *   node tests/run.mjs
 */

import { report } from './harness.mjs'
import { run as runHost } from './host.test.mjs'
import { run as runClient } from './client.test.mjs'

const totals = { pass: 0, fail: 0 }

for (const suite of [runHost, runClient]) {
  const result = await suite(report)
  totals.pass += result.pass
  totals.fail += result.fail
}

console.log('')
if (totals.fail === 0) {
  console.log('all suites passed')
  process.exit(0)
}
console.log(`${totals.fail} failing check(s)`)
process.exit(1)
