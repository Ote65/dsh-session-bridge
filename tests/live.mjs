/**
 * Out-of-process proof that the bridge really serves over HTTP.
 *
 * Activates the shipped Host half with a stand-in context, lets it bind its own
 * loopback listener, and drives every route over a real socket — including the
 * `/expose` self-check, which reaches its own URL the same way an outside Agent
 * would. No DSH, no cookie, no header.
 *
 *   node tests/live.mjs
 */

import { apply, routes } from '../lib/index.js'

const PORT = Number(process.env.BRIDGE_TEST_PORT ?? 19999)
const BASE = `http://127.0.0.1:${PORT}`

/** One conversation to expose, blocked on a question. */
const events = [
  { seq: 1, time: 10, type: 'user/message', data: { content: [{ type: 'text', text: 'Switch the render kernel to Motiongraph' }] } },
  { seq: 2, time: 11, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'First let me look at how the scenes use the API' }] } } },
  {
    seq: 3,
    time: 12,
    type: 'tool/call',
    data: {
      turn: 1,
      step: 1,
      callId: 'c1',
      name: 'ask_user_question',
      arguments: JSON.stringify({
        questions: [{
          id: 'q1',
          question: 'There are uncommitted changes — what should happen?',
          options: [{ label: 'Commit first, then release' }, { label: 'Use --allow-dirty' }],
        }],
      }),
    },
  },
]
const session = {
  header: { cwd: 'E:\\OltraZ1.1', createdAt: 1700000000000, agentPreset: 'cordis' },
  seq: 4,
  snapshotEvents: (from = 0, to = 4) => events.filter((event) => event.seq >= from && event.seq < to),
  requestContext: () => ({ provider: 'deepseek', model: 'deepseek-v4.1-flash' }),
}

const ctx = {
  effect(body) { return body() },
  get(name) {
    if (name === 'sessions') return { get: (id) => (id === 'session-demo' ? session : undefined) }
    if (name === 'agents') return { get: (id) => (id === 'session-demo' ? { id: 'session-demo' } : undefined) }
    // Stands in for the shipped command registry: an unknown line resolves to
    // `undefined`, exactly like `commands.execute` does for a non-command.
    if (name === 'commands') return { execute: async () => undefined }
    if (name === 'userQuestions') return { answer: () => false }
    return undefined
  },
  logger: { warn: (message) => console.log(`[warn] ${message}`) },
}

routes.length = 0
apply(ctx, { port: PORT, baseUrl: BASE })

// Give the listener a moment to bind.
await new Promise((resolve) => setTimeout(resolve, 300))

/**
 * Drive one route over the real socket.
 * @param label - the narration line.
 * @param path - the request path.
 * @param init - optional fetch init.
 */
const show = async (label, path, init) => {
  const response = await fetch(BASE + path, init)
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = text }
  console.log(`\n${label}\n  ${init?.method ?? 'GET'} ${path}\n  -> ${response.status}`)
  return { status: response.status, body }
}

console.log(`[live] ${routes.length} routes registered; listener on ${BASE}`)

const bad = await show('1) an unknown bridge is rejected', '/session-bridge/info?bridge=nope')
if (bad.status !== 404) process.exitCode = 1

const exposed = await show('2) expose — its self-check opens a real socket to itself', '/session-bridge/expose?sessionId=session-demo')
if (exposed.status !== 200 || exposed.body?.ok !== true) {
  console.log('   FAILED:', JSON.stringify(exposed.body))
  process.exit(1)
}
const bridge = exposed.body.document.bridge
console.log(`  access=${exposed.body.document.access}  bridge=${bridge}`)
console.log('\n--- the handoff prompt handed to the clipboard ---')
console.log(exposed.body.prompt)
console.log('-------------------------------------------------')

const transcript = await show('3) transcript', `/session-bridge/transcript?bridge=${bridge}&since=0`)
console.log(`  events=${transcript.body.events.length}  seq=${transcript.body.seq}`)

const pending = await show('4) the pending question', `/session-bridge/pending?bridge=${bridge}`)
console.log(`  pending=${pending.body.pending === null ? 'null' : JSON.stringify(pending.body.pending).slice(0, 200)}`)

const empty = await show('5) a command that does not exist (no side effect)', '/session-bridge/command', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ bridge, line: '/definitely-not-a-command' }),
})
console.log(`  ok=${empty.body.ok} ran=${empty.body.ran}`)

const revoked = await show('6) revoke', `/session-bridge/revoke?bridge=${bridge}`)
console.log(`  exposed=${revoked.body.exposed}`)
const after = await fetch(`${BASE}/session-bridge/info?bridge=${bridge}`)
console.log(`\n7) after revoke -> ${after.status} (expect 404)`)

console.log('\n[live] done')
process.exit(0)
