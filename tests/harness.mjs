/** A tiny assertion + reporting harness shared by both suites. */

export function assert(condition, message) {
  if (condition !== true) throw new Error(message ?? 'assertion failed')
}

export function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

export function includes(haystack, needle, message) {
  if (typeof haystack !== 'string' || haystack.includes(needle) === false) {
    throw new Error(`${message ?? 'missing substring'}: ${JSON.stringify(needle)} in ${JSON.stringify(String(haystack).slice(0, 300))}`)
  }
}

/** Let queued microtasks and timers run. */
export function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function createSuite(name) {
  const results = []
  return {
    name,
    results,
    check(label, body) {
      try {
        body()
        results.push({ ok: true, label })
      } catch (error) {
        results.push({ ok: false, label, detail: String(error && error.message) })
      }
    },
    async checkAsync(label, body) {
      try {
        await body()
        results.push({ ok: true, label })
      } catch (error) {
        results.push({ ok: false, label, detail: String(error && error.message) })
      }
    },
  }
}

export function report(suite) {
  const pass = suite.results.filter((item) => item.ok).length
  const fail = suite.results.length - pass
  console.log(`\n${suite.name}: ${pass}/${suite.results.length} passed`)
  for (const item of suite.results) {
    if (item.ok) continue
    console.log(`  FAIL  ${item.label}\n        ${item.detail}`)
  }
  return { pass, fail }
}