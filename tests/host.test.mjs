/**
 * Host-half checks: the routes it owns, the exposure lifecycle, the discovery
 * document, the incremental transcript, the handoff prompt, and the self-check
 * that keeps a broken URL off the clipboard.
 */

import { assert, createSuite, equal, includes, report } from './harness.mjs'
import { __internals, apply, routes } from '../lib/index.js'

const { handoffPrompt, summariseEvent, extractText, ROUTE_PREFIX } = __internals

/**
 * A session stand-in with the surface the Host half reads.
 *
 * Mirrors the shipped contract: `snapshotEvents(fromSeq, toSeqExclusive)` is
 * half-open, and `seq` is the NEXT offset (one past the last event), so the
 * response's `seq` is exactly the cursor to pass back as `since`.
 */
function fakeSession(events, options = {}) {
  const next = options.seq ?? (events.length === 0 ? 0 : events[events.length - 1].seq + 1)
  return {
    header: { cwd: 'E:\\proj', createdAt: 1700000000000, agentPreset: 'cordis' },
    seq: next,
    snapshotEvents: (from = 0, to = next) => events.filter((event) => event.seq >= from && event.seq < to),
    requestContext: () => ({ provider: 'deepseek', model: 'deepseek-v4.1-flash' }),
  }
}

/** A context stand-in that records what the plugin registers. */
function makeCtx(options = {}) {
  const sessions = new Map(options.sessions ?? [])
  const registered = []
  const effects = []
  const ctx = {
    effects,
    effect(body) {
      const dispose = body()
      effects.push(dispose)
      return dispose
    },
    inject(names, body) {
      // Cordis exposes an injected service as a property on the scope context.
      body(Object.assign({}, ctx, { webServer: ctx.get('webServer') }))
    },
    get(name) {
      if (name === 'sessions') return { get: (id) => sessions.get(id) }
      if (name === 'agents') return options.agents
      if (name === 'webServer') {
        return {
          register(route) {
            registered.push(route)
            return () => {}
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  return { ctx, registered, sessions, effects }
}

/**
 * Boot one fresh activation.
 * @param options - the sessions/agents to seed.
 * @param config - the plugin config.
 * @returns the activation.
 */
function boot(options = {}, config = {}) {
  routes.length = 0
  const made = makeCtx(options)
  apply(made.ctx, Object.assign({ baseUrl: 'http://127.0.0.1:19387', port: 19399, selfCheck: options.probe ?? (async () => true) }, config))
  return made
}

/** A fake Node request carrying an optional JSON body. */
function makeReq(route, options = {}) {
  const listeners = new Map()
  const req = {
    method: options.method ?? 'GET',
    url: route.path + (options.query ?? ''),
    on(event, handler) {
      listeners.set(event, handler)
      return req
    },
  }
  // Deliver the body on the next tick, the way a real stream would.
  setTimeout(() => {
    if (options.body !== undefined) {
      const handler = listeners.get('data')
      if (handler !== undefined) handler(Buffer.from(JSON.stringify(options.body), 'utf8'))
    }
    const end = listeners.get('end')
    if (end !== undefined) end()
  }, 0)
  return req
}

/** A fake Node response that records the JSON it was handed. */
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    text: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers ?? {}; return this },
    end(text) { this.text = text ?? ''; return this },
  }
}

/** Drive one registered route from the most recent boot. */
async function call(path, options = {}) {
  const route = routes.filter((candidate) => candidate.path === `${ROUTE_PREFIX}${path}`).pop()
  assert(route !== undefined, `no route for ${path}`)
  const req = makeReq(route, Object.assign({}, options, { method: options.method ?? 'GET' }))
  const res = makeRes()
  await route.handler(req, res)
  return { status: res.statusCode, body: res.text === '' ? null : JSON.parse(res.text) }
}

/**
 * Run `body` with the global fetch stubbed.
 * @param stub - the replacement.
 * @param body - the work.
 */
async function withFetch(stub, body) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await body()
  } finally {
    globalThis.fetch = original
  }
}

/**
 * Run the Host suite.
 * @param reportFn - the shared reporter.
 */
export async function run(reportFn) {
  const suite = createSuite('host')
  const okFetch = async () => ({ status: 200 })

  suite.check('registers every route on the plain web server', () => {
    boot()
    equal(routes.length, 8, 'route count')
    const paths = routes.map((route) => route.path).sort()
    for (const path of paths) includes(path, ROUTE_PREFIX, 'under the bridge prefix')
    includes(paths.join(' '), '/expose', 'expose route')
    includes(paths.join(' '), '/transcript', 'transcript route')
    includes(paths.join(' '), '/status', 'status route')
    includes(paths.join(' '), '/info', 'info route')
    includes(paths.join(' '), '/revoke', 'revoke route')
    includes(paths.join(' '), '/pending', 'pending route')
    includes(paths.join(' '), '/answer', 'answer route')
    includes(paths.join(' '), '/command', 'command route')
  })

  await suite.checkAsync('expose mints a capability id and returns a working prompt', async () => {
    boot({ sessions: [['session-abc', fakeSession([])]] })
    await withFetch(okFetch, async () => {
      const { status, body } = await call('/expose', { query: '?sessionId=session-abc' })
      equal(status, 200, 'status')
      equal(body.ok, true, 'ok')
      equal(body.reused, false, 'fresh')
      // 128 bits of capability, since the URL itself is the credential.
      equal(body.document.bridge.length >= 22, true, 'long capability id')
      includes(body.prompt, '【DSH 会话桥】', 'prompt head')
      includes(body.prompt, 'session-abc', 'prompt names the session')
      includes(body.prompt, '不需要任何 header', 'prompt promises no auth')
      includes(body.prompt, '先读、再决定、读完就停', 'prompt tells the receiver to stop')
      includes(body.prompt, 'POST', 'prompt advertises the write API')
    })
  })

  await suite.checkAsync('expose refuses to hand over a URL that does not answer 200', async () => {
    boot({ sessions: [['session-abc', fakeSession([])]], probe: async () => 'HTTP 401' })
    {
      const { status, body } = await call('/expose', { query: '?sessionId=session-abc' })
      equal(status, 502, 'reported, not hidden')
      equal(body.ok, false, 'not ok')
      includes(body.error, 'HTTP 401', 'the reason is named')
      const after = await call('/info', { query: `?bridge=${body.document.bridge}` })
      equal(after.status, 404, 'the unusable exposure was rolled back')
    }
  })

  await suite.checkAsync('a second expose of the same session reuses the bridge', async () => {
    boot({ sessions: [['session-abc', fakeSession([])]] })
    await withFetch(okFetch, async () => {
      const first = await call('/expose', { query: '?sessionId=session-abc' })
      const second = await call('/expose', { query: '?sessionId=session-abc' })
      equal(second.body.reused, true, 'reused')
      equal(second.body.document.bridge, first.body.document.bridge, 'same bridge id')
    })
  })

  await suite.checkAsync('expose refuses a missing sessionId', async () => {
    boot()
    const { status, body } = await call('/expose', { query: '' })
    equal(status, 400, 'status')
    equal(body.ok, false, 'not ok')
  })

  await suite.checkAsync('info answers the discovery document', async () => {
    boot(
      { sessions: [['session-abc', fakeSession([{ seq: 5, time: 1, type: 'turn/start', data: { turn: 1 } }])]] },
      { baseUrl: 'http://127.0.0.1:19387/' },
    )
    await withFetch(okFetch, async () => {
      const exposed = await call('/expose', { query: '?sessionId=session-abc' })
      const bridge = exposed.body.document.bridge
      const { status, body } = await call('/info', { query: `?bridge=${bridge}` })
      equal(status, 200, 'status')
      equal(body.session, 'session-abc', 'session')
      equal(body.cwd, 'E:\\proj', 'cwd from the header')
      equal(body.model.model, 'deepseek-v4.1-flash', 'model')
      equal(body.access, 'read-write', 'access')
      equal(body.seq, 6, 'seq is the next offset')
      includes(body.endpoints.transcript, 'http://127.0.0.1:19387/session-bridge/transcript', 'absolute endpoint, trailing slash trimmed')
      includes(body.howToUse, 'since', 'explains incremental reads')
      includes(body.howToUse, 'the URL is the credential', 'states that no auth is needed')
      includes(body.howToUse, 'Writes are POSTs', 'advertises the write API') 
    })
  })

  await suite.checkAsync('an unknown bridge is a 404', async () => {
    boot()
    for (const path of ['/info', '/status', '/transcript']) {
      const { status } = await call(path, { query: '?bridge=nope' })
      equal(status, 404, `${path} 404s`)
    }
  })

  await suite.checkAsync('a wrong method is a 405', async () => {
    boot()
    const { status, body } = await call('/info', { method: 'POST', query: '?bridge=nope' })
    equal(status, 405, 'method not allowed')
    equal(body.ok, false, 'not ok')
  })

  await suite.checkAsync('transcript reads from `since` and reports the head seq', async () => {
    const events = [
      { seq: 1, time: 10, type: 'user/message', data: { content: [{ type: 'text', text: '你好' }] } },
      { seq: 2, time: 11, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在的' }] }, usage: { inputTokens: 5, outputTokens: 2 } } },
      { seq: 3, time: 12, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } },
      { seq: 4, time: 13, type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] } } },
      { seq: 5, time: 14, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    boot({ sessions: [['session-abc', fakeSession(events)]] })
    await withFetch(okFetch, async () => {
      const exposed = await call('/expose', { query: '?sessionId=session-abc' })
      const bridge = exposed.body.document.bridge

      const full = await call('/transcript', { query: `?bridge=${bridge}&since=0` })
      equal(full.body.events.length, 5, 'all events')
      equal(full.body.events[0].role, 'user', 'first is the user message')
      equal(full.body.events[0].text, '你好', 'user text extracted')
      equal(full.body.events[1].role, 'assistant', 'second is the assistant')
      equal(full.body.events[1].text, '在的', 'assistant text extracted')
      equal(full.body.events[2].tool, 'bash', 'tool name')
      equal(full.body.events[3].callId, 'c1', 'tool result correlates')
      equal(full.body.events[4].reason, 'completed', 'turn end reason')
      equal(full.body.seq, 6, 'head seq is the NEXT offset')

      // The cursor contract: the response's `seq` is what to send back as `since`.
      const caughtUp = await call('/transcript', { query: `?bridge=${bridge}&since=${full.body.seq}` })
      equal(caughtUp.body.events.length, 0, 'nothing new when caught up')

      const incremental = await call('/transcript', { query: `?bridge=${bridge}&since=5` })
      equal(incremental.body.events.length, 1, 'only the new event')
      equal(incremental.body.events[0].seq, 5, 'the new event')
    })
  })

  await suite.checkAsync('revoke drops the exposure', async () => {
    boot({ sessions: [['session-abc', fakeSession([])]] })
    await withFetch(okFetch, async () => {
      const exposed = await call('/expose', { query: '?sessionId=session-abc' })
      const bridge = exposed.body.document.bridge
      await call('/revoke', { query: '?sessionId=session-abc' })
      const after = await call('/info', { query: `?bridge=${bridge}` })
      equal(after.status, 404, 'gone')
    })
  })

  suite.check('event summaries survive unknown shapes', () => {
    equal(summariseEvent(undefined).type, undefined, 'undefined event tolerated')
    equal(summariseEvent({ seq: 1, type: 'unknown/thing', data: {} }).seq, 1, 'unknown type kept')
    equal(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb', 'block array joined')
    equal(extractText('plain'), 'plain', 'string passthrough')
    equal(extractText(null), '', 'null is empty')
  })

  suite.check('the handoff prompt is self-contained', () => {
    const document = {
      bridge: 'abc123',
      session: 'session-xyz',
      title: '欧创渲染内核',
      cwd: 'E:\\OltraZ1.1',
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
      exposedSeconds: 3,
      seq: 128,
      endpoints: {
        info: 'http://127.0.0.1:19387/session-bridge/info?bridge=abc123',
        status: 'http://127.0.0.1:19387/session-bridge/status?bridge=abc123',
        transcript: 'http://127.0.0.1:19387/session-bridge/transcript?bridge=abc123&since=0',
      },
    }
    const prompt = handoffPrompt(document)
    includes(prompt, 'http://127.0.0.1:19387/session-bridge/info?bridge=abc123', 'info url')
    includes(prompt, 'E:\\OltraZ1.1', 'cwd')
    includes(prompt, 'deepseek/deepseek-v4.1-flash', 'model')
    includes(prompt, 'seq=128', 'head seq')
    includes(prompt, '`since`', 'incremental hint')
    includes(prompt, '不需要任何 header', 'no-auth promise')
    assert(prompt.split('\n').length >= 8, 'multi-line')
  })

  return reportFn(suite)
}
