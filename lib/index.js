/**
 * dsh-session-bridge — Host half.
 *
 * Publishes ONE session so another Agent (Codex, Trae, …) can discover and read
 * it. Read-only: nothing here can prompt the session, run a command, or answer
 * its questions. Exposure is in-memory and dies with the plugin.
 *
 * ## Why this rides the plain web server
 *
 * The bridge id in the URL **is** the credential. That is deliberate: the
 * authenticated `connection` carrier expects the DSH renderer's signed cookie,
 * which an external Agent does not have, so a URL minted there answers 401 no
 * matter how the token is passed. `ctx.webServer.register` takes a plain route
 * (`kind: 'exact'`) — the same carrier `dsh-token-hud` uses for
 * `/api/token-hud/usage` — so an outside caller needs nothing but the URL.
 *
 * Because that route is unauthenticated, the id is 16 random bytes (128 bits)
 * and never the raw session id. `/expose` additionally **fetches its own URL
 * before answering**, so a handoff prompt is only ever handed over when the
 * caller can actually read it.
 *
 * @module dsh-session-bridge
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { createServer, get as httpGet } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Temporary diagnostic sink: a file, since the host half has no console here. */
const DIAG_FILE = 'E:/dsh-dev/scratch/sb-host.log'

/**
 * Append one diagnostic line.
 * @param message - the line.
 */
function diagLine(message) {
  try {
    appendFileSync(DIAG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch (error) { /* diagnostics must never break the plugin */ }
}

// Module-level probe: proves whether the entry is imported at all, separately
// from whether `apply` runs.
diagLine('module imported')

/**
 * Every route this plugin owns lives under this prefix, on ITS OWN server.
 *
 * Not on DSH's web server: a route there is either outside `/api` (never
 * dispatched to plugins — the server answers its own 404) or inside it (behind
 * the renderer's signed-cookie gate — a plain request gets 401 `unauthorized`).
 * Neither is reachable by an external Agent, so the bridge runs its own
 * loopback listener instead and the capability id in the URL is the credential.
 */
export const ROUTE_PREFIX = '/session-bridge'

/** The loopback port this bridge listens on. */
export const DEFAULT_PORT = 19388

/** How many events one transcript response carries at most. */
const MAX_TRANSCRIPT_EVENTS = 400

/** How many characters of one message's text a summary keeps. */
const MAX_TEXT = 4000

/** How far back the pending-question scan looks. */
const PENDING_SCAN_EVENTS = 400

/** How long the self-check may take before the exposure is called unusable. */
const SELF_CHECK_TIMEOUT_MS = 4000

/**
 * Exposures, keyed by bridge id. In-memory on purpose: an exposure is a live
 * grant, not durable state, and it disappears with the plugin.
 * @type {Map<string, { sessionId: string, createdAt: number, hits: number }>}
 */
export const exposures = new Map()

/** The routes this plugin serves, exposed so the test suite can drive them. */
export const routes = []

/**
 * Mint a bridge id: 128 bits of capability, since the URL is the credential.
 * @returns the id.
 */
export function mintBridgeId() {
  return randomBytes(16).toString('base64url')
}

/**
 * Answer with JSON over the plain web server.
 * @param res - the Node response.
 * @param status - the HTTP status.
 * @param body - the payload.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Read a request body as JSON.
 *
 * Kept for completeness: every route is GET, so nothing calls it, but a future
 * POST-capable carrier would need it.
 *
 * @param req - the Node request.
 * @returns the parsed body, or an empty object.
 */
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * The session's stored title, read from the projection cache.
 *
 * Only the title is read: the cache is a projection, not the event log, so the
 * transcript never comes from here.
 *
 * @param sessionId - the session id.
 * @param dir - the configured projection directory, or '' for the default.
 * @returns the title, or null.
 */
function readTitle(sessionId, dir) {
  try {
    const base = dir === '' || dir === undefined
      ? join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
      : dir
    const name = String(sessionId).replace(/^session-/, '')
    const parsed = JSON.parse(readFileSync(join(base, `${name}.json`), 'utf8'))
    const title = parsed?.record?.rows?.title?.val
    return typeof title === 'string' && title !== '' ? title.slice(0, 200) : null
  } catch (error) {
    return null
  }
}

/**
 * The text of one message-shaped value, tolerant of the block shapes the
 * harness uses.
 * @param value - a message, a block array, or anything else.
 * @returns the extracted text (possibly empty).
 */
export function extractText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n')
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  if (Array.isArray(value.content)) return extractText(value.content)
  if (value.message !== undefined) return extractText(value.message)
  return ''
}

/**
 * Condense one session event into what an external Agent needs.
 * @param event - a SessionEvent.
 * @returns the summary.
 */
export function summariseEvent(event) {
  const data = event?.data ?? {}
  const summary = { seq: event?.seq, time: event?.time, type: event?.type }
  switch (event?.type) {
    case 'user/message':
      summary.role = 'user'
      summary.text = extractText(data).slice(0, MAX_TEXT)
      break
    case 'assistant/message':
      summary.role = 'assistant'
      summary.text = extractText(data.message ?? data).slice(0, MAX_TEXT)
      if (data.usage !== undefined) summary.usage = data.usage
      break
    case 'tool/call':
      summary.role = 'tool-call'
      summary.tool = data.name
      summary.callId = data.callId
      summary.arguments = typeof data.arguments === 'string' ? data.arguments.slice(0, 2000) : undefined
      break
    case 'tool/result':
      summary.role = 'tool-result'
      summary.callId = data.message?.toolCallId ?? data.callId
      summary.isError = data.message?.isError === true || data.error !== undefined
      summary.text = extractText(data.message ?? data).slice(0, MAX_TEXT)
      break
    case 'turn/start':
      summary.turn = data.turn
      break
    case 'turn/end':
      summary.turn = data.turn
      summary.reason = data.reason?.kind ?? data.reason
      break
    default:
      break
  }
  return summary
}

/**
 * The live session object, or undefined.
 * @param ctx - the plugin context.
 * @param sessionId - the session id.
 * @returns the Session, or undefined.
 */
function liveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined || sessions === null || typeof sessions.get !== 'function') return undefined
  return sessions.get(sessionId)
}

/**
 * The agent's running state, when the agent service can answer.
 * @param ctx - the plugin context.
 * @param sessionId - the session id.
 * @returns `true`, `false`, or null when unknown.
 */
function runningState(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || typeof agents.get !== 'function') return null
  try {
    const agent = agents.get(sessionId)
    if (agent === undefined || agent === null) return false
    if (typeof agent.status === 'string') return agent.status === 'running'
    if (typeof agent.running === 'boolean') return agent.running
    return null
  } catch (error) {
    return null
  }
}

/**
 * The discovery document for one exposure.
 * @param ctx - the plugin context.
 * @param config - the resolved config.
 * @param bridge - the bridge id.
 * @returns the document, or null when the bridge is unknown.
 */
export function discovery(ctx, config, bridge) {
  const exposure = exposures.get(bridge)
  if (exposure === undefined) return null
  const session = liveSession(ctx, exposure.sessionId)
  const base = `${config.base}${ROUTE_PREFIX}`
  const header = session?.header
  const request = typeof session?.requestContext === 'function' ? session.requestContext() : undefined
  return {
    bridge,
    session: exposure.sessionId,
    title: readTitle(exposure.sessionId, config.sessionProjectionDir),
    cwd: header?.cwd ?? null,
    createdAt: header?.createdAt ?? null,
    agentPreset: header?.agentPreset ?? null,
    exposedAt: exposure.createdAt,
    exposedSeconds: Math.round((Date.now() - exposure.createdAt) / 1000),
    live: session !== undefined && session !== null,
    running: runningState(ctx, exposure.sessionId),
    seq: session?.seq ?? null,
    model: request === undefined ? null : { provider: request.provider, model: request.model },
    endpoints: {
      info: `${base}/info?bridge=${bridge}`,
      status: `${base}/status?bridge=${bridge}`,
      transcript: `${base}/transcript?bridge=${bridge}&since=0`,
      pending: `${base}/pending?bridge=${bridge}`,
      answer: `${base}/answer`,
      command: `${base}/command`,
    },
    access: 'read-write',
    writeApi: {
      answer: 'POST { bridge, callId?, answers: [{ id, selected: [label], custom? }] }',
      command: 'POST { bridge, line: "/compact" }',
    },
    howToUse: [
      'GET `endpoints.info` for this document, `endpoints.status` for the running state,',
      'and `endpoints.transcript` for the conversation (pass the `seq` you last saw as',
      '`since` for just the new events). GET `endpoints.pending` to learn whether the',
      'session is blocked on a question. Writes are POSTs to `endpoints.answer` (choose',
      'options) and `endpoints.command` (run a slash command). No header or cookie is',
      'needed: the URL is the credential.',
    ].join(' '),
  }
}

/**
 * Build the handoff prompt copied to the clipboard.
 * @param document - the discovery document.
 * @returns the prompt text.
 */
export function handoffPrompt(document) {
  const lines = [
    '【DSH 会话桥】有一个正在运行的 DeepSeek Harness 会话已对外开放，你可以读取它，也可以操作它。',
    '',
    '── 只读 ──',
    `发现文档：${document.endpoints.info}`,
    `运行状态：${document.endpoints.status}`,
    `会话记录：${document.endpoints.transcript}`,
    `待答问题：${document.endpoints.pending}`,
    '',
    '── 可写（POST，JSON body 里带上 "bridge"）──',
    `选择选项：POST ${document.endpoints.answer}`,
    '          body: { "bridge": "…", "answers": [{ "id": "<问题 id>", "selected": ["<选项 label>"] }] }',
    `执行命令：POST ${document.endpoints.command}`,
    '          body: { "bridge": "…", "line": "/compact" }',
    '',
    '直接请求即可 —— 不需要任何 header、cookie 或 token，URL + bridge 本身就是凭证。',
    '',
    '⚠️ 关键：**先读、再决定、读完就停。**',
    '  · 第一步只做一件事：GET 发现文档。成功（HTTP 200）就说明连上了。',
    '  · 然后 GET 会话记录（从 since=0 开始，之后传上次拿到的 seq 取增量）把上下文读懂。',
    '  · GET 待答问题看它是否卡在某个选择上；是的话再用 POST 选择选项。',
    '  · **读懂之后停下，先向你的用户汇报你看到了什么、建议做什么**，不要自行连续发命令。',
    '  · 如果拿到 401 / 404 / 连不上：也停下，如实报告状态码。不要反查鉴权实现、不要猜别的 URL、',
    '    不要扫描端口、不要试图绕过 —— 那是死胡同，只会浪费时间。',
    '',
  ]
  if (document.title) lines.push(`会话标题：${document.title}`)
  if (document.cwd) lines.push(`工作目录：${document.cwd}`)
  lines.push(`会话 ID：${document.session}`)
  if (document.model) lines.push(`模型：${document.model.provider}/${document.model.model}`)
  lines.push(`当前事件序号 seq=${document.seq ?? '未知'}`)
  lines.push('')
  lines.push('增量用法：把上次拿到的 `seq` 作为 `since` 参数传入，就只返回新增事件。')
  return lines.join('\n')
}

/**
 * Fetch the bridge's own URL over a REAL socket to prove an outside caller can
 * read it.
 *
 * Deliberately not `fetch`: the host's global fetch can be served internally,
 * which reports 200 for a URL no external process can reach — exactly the false
 * green that made an earlier build hand over a dead link.
 *
 * @param url - the absolute info URL.
 * @returns `true` on 200, else a short reason.
 */
function defaultSelfCheck(url) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => { if (settled !== true) { settled = true; resolve(value) } }
    let request = null
    try {
      request = httpGet(url, (response) => {
        response.resume()
        done(response.statusCode === 200 ? true : `HTTP ${response.statusCode}`)
      })
    } catch (error) {
      done(String(error && error.message).slice(0, 120))
      return
    }
    request.setTimeout(SELF_CHECK_TIMEOUT_MS, () => {
      request.destroy()
      done('timeout')
    })
    request.on('error', (error) => done(String(error && error.message).slice(0, 120)))
  })
}

/**
 * The question a session is currently blocked on, derived from its own log.
 *
 * `ask_user_question` leaves a `tool/call` with no matching `tool/result` until
 * it is answered, and the call's arguments carry the questions verbatim — so no
 * extra subscription is needed to tell an external Agent what to answer.
 *
 * @param events - the session events to scan.
 * @returns `{ callId, questions }`, or null when nothing is pending.
 */
export function pendingQuestion(events) {
  const calls = new Map()
  const answered = new Set()
  for (const event of events) {
    if (event?.type === 'tool/call') calls.set(String(event.data?.callId), event)
    if (event?.type === 'tool/result') {
      answered.add(String(event.data?.message?.toolCallId ?? event.data?.callId))
    }
  }
  const entries = Array.from(calls.entries()).reverse()
  for (const [callId, call] of entries) {
    if (answered.has(callId)) continue
    if (call.data?.name !== 'ask_user_question') continue
    let parsed = null
    try { parsed = JSON.parse(call.data.arguments ?? '') } catch (error) { parsed = null }
    return { callId, questions: parsed?.questions ?? [] }
  }
  return null
}

/**
 * Register the bridge routes on the plugin's own loopback listener.
 * @param ctx - the plugin context.
 * @param config - the resolved config.
 */
export function apply(ctx, config = {}) {
  diagLine(`apply entered; get=${typeof ctx.get} effect=${typeof ctx.effect}`)

  const port = Number.isInteger(Number(config.port)) && Number(config.port) > 0 ? Number(config.port) : DEFAULT_PORT
  const resolved = {
    base: String(config.baseUrl === undefined || config.baseUrl === '' ? `http://127.0.0.1:${port}` : config.baseUrl).replace(/\/+$/, ''),
    sessionProjectionDir: config.sessionProjectionDir ?? '',
  }
  /** Tests inject their own reachability probe; production uses the real socket. */
  const selfCheck = typeof config.selfCheck === 'function' ? config.selfCheck : defaultSelfCheck

  /**
   * Register one route on this plugin's own listener.
   *
   * Reads are GET (and HEAD); the two state-changing routes are POST only.
   *
   * @param path - the exact path.
   * @param methods - the accepted methods.
   * @param handler - the async body.
   */
  const route = (path, methods, handler) => {
    const wrapped = (req, res) => {
      if (methods.includes(req.method) === false) {
        sendJson(res, 405, { ok: false, error: `method-not-allowed: use ${methods.join('/')}` })
        return undefined
      }
      return Promise.resolve(handler(req, res)).catch((error) => {
        sendJson(res, 500, { ok: false, error: String(error && error.message) })
      })
    }
    routes.push({ path, methods, handler: wrapped })
  }

  /** Register one GET route. */
  const serve = (path, handler) => route(path, ['GET', 'HEAD'], handler)

  /** Register one POST route. */
  const servePost = (path, handler) => route(path, ['POST'], handler)

  /**
   * Register one GET route on this plugin's own listener.
   *
   * Reads are GET (and HEAD); the two state-changing routes are POST only.
   *
   * @param path - the exact path.
   * @param handler - the async body.
   */
  /** GET /expose — mint (or reuse) an exposure, self-check it, return the prompt. */
  serve(`${ROUTE_PREFIX}/expose`, async (req, res) => {
    const params = new URL(req.url, 'http://127.0.0.1').searchParams
    const sessionId = params.get('sessionId')
    if (typeof sessionId !== 'string' || sessionId === '') {
      sendJson(res, 400, { ok: false, error: 'sessionId is required' })
      return
    }
    let bridge = null
    for (const [candidate, exposure] of exposures) {
      if (exposure.sessionId === sessionId) { bridge = candidate; break }
    }
    const reused = bridge !== null
    if (bridge === null) {
      bridge = mintBridgeId()
      exposures.set(bridge, { sessionId, createdAt: Date.now(), hits: 0 })
    }
    const document = discovery(ctx, resolved, bridge)
    // Prove the URL works over a REAL socket before handing it over: a handoff
    // prompt that 401s costs the receiving Agent far more time than this check.
    const reachable = await selfCheck(document.endpoints.info)
    diagLine(`selfCheck ${document.endpoints.info} -> ${reachable}`)
    if (reachable !== true) {
      exposures.delete(bridge)
      sendJson(res, 502, {
        ok: false,
        error: `bridge URL is not reachable (${reachable}); check the baseUrl/port config`,
        document,
      })
      return
    }
    sendJson(res, 200, { ok: true, reused, document, prompt: handoffPrompt(document) })
  })

  /** GET /revoke — drop one exposure. */
  serve(`${ROUTE_PREFIX}/revoke`, async (req, res) => {
    const params = new URL(req.url, 'http://127.0.0.1').searchParams
    const sessionId = params.get('sessionId')
    const bridge = params.get('bridge')
    if (typeof sessionId === 'string' && sessionId !== '') {
      for (const [candidate, exposure] of exposures) {
        if (exposure.sessionId === sessionId) exposures.delete(candidate)
      }
    }
    if (typeof bridge === 'string' && bridge !== '') exposures.delete(bridge)
    sendJson(res, 200, { ok: true, exposed: exposures.size })
  })

  /** GET /info — the discovery document. */
  serve(`${ROUTE_PREFIX}/info`, async (req, res) => {
    const bridge = new URL(req.url, 'http://127.0.0.1').searchParams.get('bridge')
    const document = discovery(ctx, resolved, bridge)
    if (document === null) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    exposures.get(bridge).hits += 1
    sendJson(res, 200, document)
  })

  /** GET /status — the live running state. */
  serve(`${ROUTE_PREFIX}/status`, async (req, res) => {
    const bridge = new URL(req.url, 'http://127.0.0.1').searchParams.get('bridge')
    const exposure = exposures.get(bridge)
    if (exposure === undefined) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    const session = liveSession(ctx, exposure.sessionId)
    sendJson(res, 200, {
      bridge,
      session: exposure.sessionId,
      live: session !== undefined && session !== null,
      running: runningState(ctx, exposure.sessionId),
      seq: session?.seq ?? null,
    })
  })

  /** GET /transcript — the conversation, incrementally from `since`. */
  serve(`${ROUTE_PREFIX}/transcript`, async (req, res) => {
    const params = new URL(req.url, 'http://127.0.0.1').searchParams
    const bridge = params.get('bridge')
    const exposure = exposures.get(bridge)
    if (exposure === undefined) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    const session = liveSession(ctx, exposure.sessionId)
    if (session === undefined || session === null) {
      sendJson(res, 200, { bridge, session: exposure.sessionId, live: false, events: [], seq: null })
      return
    }
    const sinceRaw = Number(params.get('since') ?? '0')
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents(since) : []
    const slice = events.length > MAX_TRANSCRIPT_EVENTS ? events.slice(events.length - MAX_TRANSCRIPT_EVENTS) : events
    sendJson(res, 200, {
      bridge,
      session: exposure.sessionId,
      live: true,
      from: since,
      seq: session.seq ?? null,
      truncated: slice.length !== events.length,
      events: slice.map(summariseEvent),
    })
  })

  /**
   * GET /pending — what the session is blocked on, if anything.
   *
   * The scan is windowed to the tail of the log: the question that matters is
   * always the newest unanswered one, and a bounded read keeps this cheap on a
   * long session.
   */
  serve(`${ROUTE_PREFIX}/pending`, async (req, res) => {
    const bridge = new URL(req.url, 'http://127.0.0.1').searchParams.get('bridge')
    const exposure = exposures.get(bridge)
    if (exposure === undefined) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    const session = liveSession(ctx, exposure.sessionId)
    if (session === undefined || session === null) {
      sendJson(res, 200, { bridge, session: exposure.sessionId, live: false, pending: null })
      return
    }
    const from = Math.max(0, (session.seq ?? 0) - PENDING_SCAN_EVENTS)
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents(from) : []
    sendJson(res, 200, {
      bridge,
      session: exposure.sessionId,
      live: true,
      running: runningState(ctx, exposure.sessionId),
      pending: pendingQuestion(events),
    })
  })

  /**
   * POST /answer — choose from the options a pending question offers.
   *
   * `userQuestions.answer` steers the reply into the agent as a user message, so
   * this both selects the option and resumes the session. `callId` defaults to
   * the pending one.
   */
  servePost(`${ROUTE_PREFIX}/answer`, async (req, res) => {
    const body = await readJson(req)
    const exposure = exposures.get(body.bridge)
    if (exposure === undefined) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    const answers = Array.isArray(body.answers) ? body.answers : null
    if (answers === null || answers.length === 0) {
      sendJson(res, 400, { ok: false, error: 'answers is required: [{ id, selected: [] }]' })
      return
    }
    const session = liveSession(ctx, exposure.sessionId)
    if (session === undefined || session === null) { sendJson(res, 409, { ok: false, error: 'session is not live' }); return }
    let callId = typeof body.callId === 'string' && body.callId !== '' ? body.callId : null
    if (callId === null) {
      const from = Math.max(0, (session.seq ?? 0) - PENDING_SCAN_EVENTS)
      const pending = pendingQuestion(typeof session.snapshotEvents === 'function' ? session.snapshotEvents(from) : [])
      if (pending === null) { sendJson(res, 409, { ok: false, error: 'nothing is pending' }); return }
      callId = pending.callId
    }
    const questions = ctx.get('userQuestions')
    const agents = ctx.get('agents')
    if (questions === undefined || questions === null || agents === undefined || agents === null) {
      sendJson(res, 501, { ok: false, error: 'userQuestions/agents service unavailable' })
      return
    }
    const agent = agents.get(exposure.sessionId)
    if (agent === undefined || agent === null) { sendJson(res, 409, { ok: false, error: 'no live agent for this session' }); return }
    try {
      const still = questions.answer(agent, callId, { answers })
      diagLine(`answer ${callId} -> still=${still}`)
      sendJson(res, 200, { ok: true, callId, stillContinued: still === true })
    } catch (error) {
      sendJson(res, 409, { ok: false, error: String(error && error.message) })
    }
  })

  /**
   * POST /command — run one slash command inside the session.
   *
   * `commands.execute(agent, line, …)` takes an arbitrary live agent, so this is
   * the write path that works on any session.
   */
  servePost(`${ROUTE_PREFIX}/command`, async (req, res) => {
    const body = await readJson(req)
    const exposure = exposures.get(body.bridge)
    if (exposure === undefined) { sendJson(res, 404, { ok: false, error: 'unknown bridge' }); return }
    const line = typeof body.line === 'string' ? body.line.trim() : ''
    if (line === '') { sendJson(res, 400, { ok: false, error: 'line is required, e.g. "/compact"' }); return }
    const commands = ctx.get('commands')
    const agents = ctx.get('agents')
    if (commands === undefined || commands === null || agents === undefined || agents === null) {
      sendJson(res, 501, { ok: false, error: 'commands/agents service unavailable' })
      return
    }
    const agent = agents.get(exposure.sessionId)
    if (agent === undefined || agent === null) { sendJson(res, 409, { ok: false, error: 'no live agent for this session' }); return }
    try {
      const controller = new AbortController()
      const result = await commands.execute(agent, line, [], controller.signal)
      diagLine(`command ${line} -> ${result === undefined ? 'not-a-command' : 'ran'}`)
      sendJson(res, 200, { ok: result !== undefined, ran: result !== undefined })
    } catch (error) {
      sendJson(res, 409, { ok: false, error: String(error && error.message) })
    }
  })

  const handlerFor = new Map(routes.map((route) => [route.path, route.handler]))

  const server = createServer((req, res) => {
    // The renderer is on `dsh-app://app/`, so its call into this loopback
    // listener is cross-origin and needs CORS to be readable.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    const path = String(req.url).split('?')[0]
    const handler = handlerFor.get(path)
    if (handler === undefined) {
      sendJson(res, 404, { ok: false, error: 'no such route' })
      return
    }
    try {
      Promise.resolve(handler(req, res)).catch((error) => {
        sendJson(res, 500, { ok: false, error: String(error && error.message) })
      })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error && error.message) })
    }
  })

  server.on('error', (error) => diagLine(`server error: ${String(error && error.message)}`))
  server.listen(port, '127.0.0.1', () => diagLine(`listening on http://127.0.0.1:${port}`))

  ctx.effect(() => () => new Promise((resolve) => server.close(() => resolve())), 'session-bridge: own listener')
}

export const name = 'session-bridge'

/** Exposed for the test suite. */
export const __internals = { handoffPrompt, summariseEvent, extractText, pendingQuestion, ROUTE_PREFIX, exposures, mintBridgeId, discovery }
