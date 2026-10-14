/**
 * Client-half checks: the bundle shape, the Session "..." menu seat, the row's
 * states, the Host call, the clipboard write, and the menu dismissal.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, createSuite, equal, flush, includes, report } from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'lib', 'client.js')

/** The one module this bundle may require. */
const TABLE = new Set(['react'])

/**
 * A React stand-in recording effects and state updates.
 * @param stateQueue - values for successive `useState` calls.
 */
function makeReact(stateQueue) {
  const effects = []
  const setters = []
  return {
    effects,
    setters,
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props ?? {})
      merged.children = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: merged }
    },
    useState(initial) {
      const next = stateQueue.length > 0 ? stateQueue.shift() : initial
      return [next, (value) => { setters.push(value) }]
    },
    useEffect(body) {
      effects.push(body)
    },
    useRef(initial) {
      return { current: initial }
    },
  }
}

/**
 * Load the bundle with controllable fakes.
 * @param options - state seed, locale, fetch and clipboard behaviour.
 */
function loadBundle(options = {}) {
  const source = readFileSync(clientPath, 'utf8')
  const specs = []
  const requires = []
  const injected = []
  const registrations = []
  const react = makeReact(options.stateQueue ?? [])
  const fetchCalls = []
  const clipboard = { written: [], fail: options.clipboardFails === true }
  const menuCalls = []
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this },
    removeChild(node) {
      const at = this.children.indexOf(node)
      if (at >= 0) this.children.splice(at, 1)
      node.parentNode = null
    },
  }
  const documentStub = {
    documentElement: { lang: options.lang ?? 'zh-CN' },
    head,
    body: { appendChild() {}, removeChild() {} },
    createElement(tag) {
      return { tag, id: '', textContent: '', value: '', style: {}, setAttribute() {}, select() {}, parentNode: null }
    },
    getElementById(id) {
      return head.children.find((node) => node.id === id) ?? null
    },
    execCommand: () => options.execCommandResult !== false,
  }
  const windowStub = { __ModuleLoader__: { load(spec) { specs.push(spec) } } }
  const navigatorStub = {
    clipboard: {
      writeText(text) {
        if (clipboard.fail) return Promise.reject(new Error('denied'))
        clipboard.written.push(text)
        return Promise.resolve()
      },
    },
  }

  // eslint-disable-next-line no-new-func -- the bundle is a browser script.
  const run = new Function('window', 'document', 'navigator', 'fetch', 'setTimeout', 'clearTimeout', source)
  const fetchStub = (url, init) => {
    fetchCalls.push({ url, init })
    const payload = options.payload ?? { ok: true, reused: false, prompt: 'PROMPT-FROM-HOST' }
    return Promise.resolve({
      ok: options.fetchOk !== false,
      status: options.fetchStatus ?? 200,
      json: () => Promise.resolve(payload),
    })
  }
  run(windowStub, documentStub, navigatorStub, fetchStub, setTimeout, clearTimeout)

  const spec = specs[0]
  const exported = spec.factory((name) => {
    requires.push(name)
    if (TABLE.has(name) === false) throw new Error(`module table miss: ${name}`)
    return react
  })

  const disposers = []
  const ctx = {
    effect(body) {
      const dispose = body()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    slots: {
      inject(name, body) { injected.push(name); return body() },
      // The real registry resolves the slot from `registration.name` and throws
      // when it is missing, so the fake refuses that too.
      register(registration, Component) {
        if (typeof registration.name !== 'string' || registration.name === '') {
          throw new Error(`slot "${registration.name}" is not declared (a parent entry's children table must declare it)`)
        }
        registrations.push({ registration, Component })
        return () => {}
      },
    },
  }
  exported.apply(ctx)

  return { spec, exported, react, requires, injected, registrations, head, disposers, fetchCalls, clipboard, menuCalls }
}

/** Render the menu row. */
function render(options = {}) {
  const bundle = loadBundle({
    stateQueue: options.stateQueue ?? ['idle', null],
    lang: options.lang,
    payload: options.payload,
    fetchOk: options.fetchOk,
    fetchStatus: options.fetchStatus,
    clipboardFails: options.clipboardFails,
    execCommandResult: options.execCommandResult,
  })
  const Component = bundle.registrations[0].Component
  const props = Object.assign({
    sessionId: 'session-abc',
    displayTitle: '欧创',
    useMenuOpenState: () => ({ close: () => bundle.menuCalls.push('close') }),
  }, options.props)
  const element = Component(props)
  return { bundle, element, Component }
}

/** Collect strings in a rendered tree. */
function textsOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textsOf(child, out); return out }
  if (typeof node === 'object' && node.props !== undefined) { textsOf(node.props.children, out); return out }
  return out
}

/** The icon element inside the row. */
function iconOf(element) {
  return (element.props.children ?? []).find((child) => child !== null && child !== undefined && child.props !== undefined && child.props.className === 'dsh-sb-icon')
}

/**
 * Run the client suite.
 * @param report - the shared reporter.
 */
export async function run(reportFn) {
  const suite = createSuite('client')

  suite.check('bundle loads under its own id and requires only react', () => {
    const bundle = loadBundle()
    equal(bundle.spec.id, 'dsh-session-bridge', 'bundle id')
    for (const name of bundle.requires) assert(TABLE.has(name), `unexpected require: ${name}`)
  })

  suite.check('exports the Cordis plugin surface', () => {
    const { exported } = loadBundle()
    equal(exported.name, 'session-bridge', 'name')
    equal(typeof exported.apply, 'function', 'apply')
    equal(exported.inject.join(','), 'slots', 'inject')
  })

  suite.check('registers as a row in the Session "..." menu', () => {
    const { injected, registrations } = loadBundle()
    equal(injected.join(','), 'sidebar.workspaces.session.menu.item', 'injected slot')
    equal(registrations.length, 1, 'one registration')
    const spec = registrations[0].registration
    equal(spec.name, 'sidebar.workspaces.session.menu.item', 'the slot the registry resolves')
    equal(spec.id, 'dsh-session-bridge', 'package-namespaced cell id')
    equal(spec.order, 350, 'between fork (300) and archive (400)')
  })

  suite.check('does not also occupy the hover strip', () => {
    const { injected } = loadBundle()
    for (const name of injected) {
      assert(name !== 'sidebar.workspaces.session.row.action', 'the hover strip is left to the shipped actions')
    }
  })

  suite.check('injects one stylesheet and removes it on dispose', () => {
    const bundle = loadBundle()
    equal(bundle.head.children.length, 1, 'installed')
    for (const dispose of bundle.disposers) dispose()
    equal(bundle.head.children.length, 0, 'removed')
  })

  suite.check('renders nothing without a session', () => {
    const { element } = render({ props: { sessionId: undefined } })
    equal(element, null, 'null for a sessionless row')
  })

  suite.check('idle row is one menuitem with a radar glyph and a short label', () => {
    const { element } = render()
    equal(element.type, 'button', 'a button')
    equal(element.props.role, 'menuitem', 'menu role')
    equal(element.props.className, 'dsh-sb-item', 'class')
    equal(element.props['data-phase'], 'idle', 'phase')
    equal(textsOf(element).join(' '), '暴露会话', 'the row text stays short')
  })

  suite.check('the description rides the hover tooltip, not the row', () => {
    const { element } = render()
    includes(element.props.title, '交接提示词', 'hover explains what happens')
    includes(element.props.title, 'Codex', 'hover names the audience')
    assert(element.props.title.length > textsOf(element).join(' ').length, 'the tooltip is the longer text')
  })

  suite.check('the glyph is a minimal radar, not an emoji', () => {
    const { element } = render()
    const icon = iconOf(element)
    assert(icon !== undefined, 'icon cell present')
    const svg = icon.props.children
    equal(svg.type, 'svg', 'an svg')
    equal(svg.props.viewBox, '0 0 16 16', 'view box')
    equal(svg.props.stroke, 'currentColor', 'rides currentColor')
    const parts = svg.props.children
    equal(parts.length, 4, 'four primitives: ring, range ring, sweep, contact')
    equal(parts[0].props.r, 5.6, 'outer ring')
    equal(parts[1].props.r, 2.6, 'range ring')
    includes(parts[2].props.d, 'M8 8', 'sweep starts at the centre')
    equal(parts[3].props.fill, 'currentColor', 'the contact is filled')
    equal(textsOf(element).some((text) => /\p{Extended_Pictographic}/u.test(text)), false, 'no emoji in the row')
  })

  await suite.checkAsync('choosing it exposes the session and copies the prompt', async () => {
    const { element, bundle } = render()
    element.props.onClick()
    await flush()
    await flush()
    equal(bundle.fetchCalls.length, 1, 'one Host call')
    includes(bundle.fetchCalls[0].url, 'http://127.0.0.1:19388/session-bridge/expose?sessionId=session-abc', 'GET route outside the cookie-gated /api prefix, argument in the query')
    equal(bundle.fetchCalls[0].init.method, 'GET', 'GET')
    equal(bundle.fetchCalls[0].init.body, undefined, 'no body')
    equal(bundle.clipboard.written.length, 1, 'clipboard written once')
    equal(bundle.clipboard.written[0], 'PROMPT-FROM-HOST', 'the Host prompt is copied verbatim')
    assert(bundle.react.setters.includes('done'), `expected the done state, saw ${JSON.stringify(bundle.react.setters)}`)
  })

  await suite.checkAsync('the confirmation shows, then the menu dismisses itself', async () => {
    const { element, bundle } = render()
    element.props.onClick()
    await flush()
    await flush()
    equal(bundle.menuCalls.length, 0, 'the menu stays open while confirming')
    await new Promise((resolve) => setTimeout(resolve, 900))
    equal(bundle.menuCalls.join(','), 'close', 'dismissed through the injected hook')
  })

  await suite.checkAsync('a failure keeps the menu open so the row can be chosen again', async () => {
    const { element, bundle } = render({ fetchOk: false, fetchStatus: 500 })
    element.props.onClick()
    await flush()
    await flush()
    assert(bundle.react.setters.includes('failed'), `expected the failed state, saw ${JSON.stringify(bundle.react.setters)}`)
    equal(bundle.clipboard.written.length, 0, 'nothing copied')
    await new Promise((resolve) => setTimeout(resolve, 900))
    equal(bundle.menuCalls.length, 0, 'the menu is not dismissed on failure')
  })

  await suite.checkAsync('a denied clipboard falls back, then reports failure', async () => {
    const { element, bundle } = render({ clipboardFails: true, execCommandResult: false })
    element.props.onClick()
    await flush()
    await flush()
    assert(bundle.react.setters.includes('failed'), `expected the failed state, saw ${JSON.stringify(bundle.react.setters)}`)
    equal(bundle.menuCalls.length, 0, 'no dismissal')
  })

  await suite.checkAsync('a denied clipboard still copies through the legacy path', async () => {
    const { element, bundle } = render({ clipboardFails: true, execCommandResult: true })
    element.props.onClick()
    await flush()
    await flush()
    assert(bundle.react.setters.includes('done'), `expected the done state, saw ${JSON.stringify(bundle.react.setters)}`)
  })

  suite.check('choosing twice in a row does not double-expose', () => {
    const { element, bundle } = render()
    element.props.onClick()
    element.props.onClick()
    equal(bundle.fetchCalls.length, 1, 'the busy guard holds')
  })

  suite.check('the busy and confirmed states stay short too', () => {
    const busy = render({ stateQueue: ['busy', null] })
    equal(busy.element.props['data-phase'], 'busy', 'busy phase')
    equal(textsOf(busy.element).join(' '), '正在暴露…', 'short busy label')
    includes(busy.element.props.title, '只读桥', 'busy tooltip explains')

    const done = render({ stateQueue: ['done', null] })
    equal(done.element.props['data-phase'], 'done', 'done phase')
    equal(textsOf(done.element).join(' '), '已复制', 'short confirmation')
    includes(done.element.props.title, '剪贴板', 'confirmation tooltip explains')

    const failed = render({ stateQueue: ['failed', null] })
    equal(textsOf(failed.element).join(' '), '暴露失败', 'short failure')
    includes(failed.element.props.title, 'baseUrl', 'failure tooltip says what to check')
  })

  suite.check('english fallback for a non-Chinese document', () => {
    const { element } = render({ lang: 'en-US' })
    equal(textsOf(element).join(' '), 'Expose session', 'english short label')
    includes(element.props.title, 'handoff prompt', 'english tooltip')
  })

  suite.check('a supplied translator wins', () => {
    const { element } = render({ props: { t: (key) => `«${key}»` } })
    equal(textsOf(element).join(' '), '«action»', 'translator used for the row')
    equal(element.props.title, '«hint»', 'translator used for the tooltip')
  })

  suite.check('a missing menu hook is survivable', () => {
    const { element } = render({ props: { useMenuOpenState: undefined } })
    equal(element.props.role, 'menuitem', 'still renders')
    element.props.onClick()
    equal(true, true, 'no throw without the hook')
  })

  return reportFn(suite)
}
