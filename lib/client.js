/**
 * dsh-session-bridge — Client half.
 *
 * One row in a Session's "..." menu, between the shipped `fork` (300) and
 * `archive` (400) rows. Choosing it exposes that Session through the Host half
 * and puts a handoff prompt on the clipboard, so the prompt can be pasted
 * straight into Codex, Trae, or any other Agent that should take over the
 * conversation.
 *
 * @module dsh-session-bridge/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-bridge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')

    /** The rows of one Session's "..." menu. */
    var SLOT = 'sidebar.workspaces.session.menu.item'

    /** Our cell id: package-namespaced, so it sits beside the shipped rows. */
    var CELL_ID = 'dsh-session-bridge'

    /** Between the shipped `fork` (300) and `archive` (400) rows. */
    var ORDER = 350

    /** The Host half's own loopback listener (DSH's web server cannot be used). */
    var BRIDGE = 'http://127.0.0.1:19388'
    var ROUTE = BRIDGE + '/session-bridge'

    /** How long the confirmation stays visible before the menu dismisses. */
    var CONFIRM_MS = 700

    /** Strings for the two locales the harness ships. */
    var DICTIONARIES = {
      zh: {
        action: '暴露会话',
        hint: '暴露此会话，并把交接提示词复制到剪贴板，供 Codex / Trae 等外部 Agent 读取。',
        busy: '正在暴露…',
        busyHint: '正在向 Host 注册这个会话的只读桥…',
        done: '已复制',
        doneHint: '交接提示词已在剪贴板，粘贴给外部 Agent 即可。',
        failed: '暴露失败',
        failedHint: '没能注册只读桥。检查 Host 侧 /api 通道与 baseUrl 配置后重试。',
      },
      en: {
        action: 'Expose session',
        hint: 'Expose this session and copy its handoff prompt for an external Agent such as Codex or Trae.',
        busy: 'Exposing…',
        busyHint: 'Registering this session’s read-only bridge with the Host…',
        done: 'Copied',
        doneHint: 'The handoff prompt is on the clipboard — paste it into the external Agent.',
        failed: 'Expose failed',
        failedHint: 'The read-only bridge was not registered. Check the Host /api carrier and the baseUrl config, then retry.',
      },
    }

    /**
     * The dictionary for the active document language.
     * @returns one of `DICTIONARIES`.
     */
    function dictionary() {
      var lang = ''
      if (typeof document !== 'undefined' && document.documentElement !== undefined && document.documentElement !== null) {
        lang = String(document.documentElement.lang || '')
      }
      return lang.toLowerCase().indexOf('zh') === 0 ? DICTIONARIES.zh : DICTIONARIES.en
    }

    /**
     * Build a translator, preferring the shell's own when it supplies one.
     * @param props - the component props.
     * @returns `(key) => string`.
     */
    function translator(props) {
      var supplied = props === undefined || props === null ? undefined : props.t
      var dict = dictionary()
      var local = function (key) { return dict[key] === undefined ? key : dict[key] }
      if (typeof supplied !== 'function') return local
      return function (key) {
        var value = supplied(key)
        return typeof value === 'string' && value !== '' && value !== key ? value : local(key)
      }
    }

    /**
     * Copy text, preferring the async clipboard and falling back to a selection.
     * @param text - the text to copy.
     * @returns whether the copy is believed to have succeeded.
     */
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (error) { /* fall through to the legacy path */ }
      try {
        var area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', 'readonly')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        area.select()
        var copied = document.execCommand('copy')
        document.body.removeChild(area)
        return copied === true
      } catch (error) {
        return false
      }
    }

    /**
     * Ask the Host half to expose one session.
     *
     * GET, not POST: a plugin route is only reached for GET on this carrier (a
     * POST answers the server's own 405 first), so the argument rides the query.
     *
     * @param sessionId - the session to expose.
     * @returns the response payload.
     */
    async function expose(sessionId) {
      var response = await fetch(ROUTE + '/expose?sessionId=' + encodeURIComponent(sessionId), { method: 'GET' })
      if (response.ok !== true) throw new Error('expose failed: ' + response.status)
      var payload = await response.json()
      if (payload === null || payload.ok !== true) throw new Error('expose refused')
      return payload
    }

    /**
     * A minimal radar glyph: a range ring, a sweep, and one contact.
     *
     * Drawn rather than borrowed — `@deepseek-ai/dsh-client-ui-primitives` is a
     * browser-side seed, but requiring it from a plugin bundle fails.
     *
     * @param size - the square edge in pixels.
     * @returns the svg element.
     */
    function RadarIcon(size) {
      return react.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          'aria-hidden': 'true',
        },
        react.createElement('circle', { cx: 8, cy: 8, r: 5.6 }),
        react.createElement('circle', { cx: 8, cy: 8, r: 2.6, opacity: 0.35 }),
        react.createElement('path', { d: 'M8 8 12.1 4.6', strokeLinecap: 'round' }),
        react.createElement('circle', { cx: 10.6, cy: 5.6, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      )
    }

    /** A check glyph for the confirmed state. */
    function CheckIcon(size) {
      return react.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        react.createElement('path', { d: 'M3.2 8.6 6.4 11.8 12.8 4.6' }),
      )
    }

    /**
     * Dismiss the menu through the injected hook, tolerating whichever shape the
     * owner projects.
     * @param props - the component props.
     */
    function dismissMenu(props) {
      var useMenuOpenState = props === undefined || props === null ? undefined : props.useMenuOpenState
      if (typeof useMenuOpenState !== 'function') return
      try {
        var state = useMenuOpenState()
        if (state === undefined || state === null) return
        if (typeof state.close === 'function') { state.close(); return }
        if (typeof state.dismiss === 'function') { state.dismiss(); return }
        if (typeof state.setOpen === 'function') { state.setOpen(false); return }
        if (typeof state === 'function') state(false)
      } catch (error) { /* the menu may already be gone */ }
    }

    /**
     * One row of the Session "..." menu.
     * @param props - owner props (`sessionId`, `displayTitle`) plus the hook context.
     * @returns a React element, or null when the row has no session.
     */
    function SessionBridgeMenuItem(props) {
      var t = translator(props)
      var sessionId = props === undefined || props === null ? undefined : props.sessionId

      var phasePair = react.useState('idle')
      var phase = phasePair[0]
      var setPhase = phasePair[1]
      var busy = react.useRef(false)

      if (sessionId === undefined || sessionId === null || sessionId === '') return null

      /**
       * Expose, copy, confirm, then dismiss. A failure keeps the menu open so the
       * row can simply be chosen again.
       * @param event - the click event.
       */
      function choose(event) {
        if (event !== undefined && event !== null && typeof event.preventDefault === 'function') event.preventDefault()
        if (busy.current === true) return
        busy.current = true
        setPhase('busy')
        expose(sessionId)
          .then(function (payload) {
            return copyText(String(payload.prompt ?? '')).then(function (copied) {
              busy.current = false
              if (copied !== true) { setPhase('failed'); return null }
              setPhase('done')
              setTimeout(function () { dismissMenu(props) }, CONFIRM_MS)
              return null
            })
          })
          .catch(function () {
            busy.current = false
            setPhase('failed')
          })
      }

      // The row stays short; the description lives in the hover tooltip.
      var short = phase === 'busy' ? t('busy') : phase === 'done' ? t('done') : phase === 'failed' ? t('failed') : t('action')
      var description = phase === 'busy' ? t('busyHint') : phase === 'done' ? t('doneHint') : phase === 'failed' ? t('failedHint') : t('hint')

      return react.createElement(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dsh-sb-item',
          'data-phase': phase,
          title: description,
          onClick: choose,
        },
        react.createElement('span', { className: 'dsh-sb-icon', 'aria-hidden': 'true' }, phase === 'done' ? CheckIcon(15) : RadarIcon(15)),
        react.createElement('span', { className: 'dsh-sb-label' }, short),
      )
    }

    var STYLE_ID = 'dsh-session-bridge-style'

    /* Matched to the shipped menu rows: a full-width row, an icon cell, and the
     * host's own tokens so light/dark and the theme plugin both carry over. */
    var STYLESHEET = [
      '.dsh-sb-item{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 10px;',
      'border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;',
      'color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;line-height:1.4;',
      'text-align:left;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.dsh-sb-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}',
      '.dsh-sb-item:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-1px}',
      '.dsh-sb-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;',
      'color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}',
      '.dsh-sb-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-sb-item[data-phase="busy"]{color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}',
      '.dsh-sb-item[data-phase="busy"] .dsh-sb-icon{opacity:.6}',
      '.dsh-sb-item[data-phase="done"],.dsh-sb-item[data-phase="done"] .dsh-sb-icon{color:var(--dsw-alias-state-success-primary,#35c07a)}',
      '.dsh-sb-item[data-phase="failed"],.dsh-sb-item[data-phase="failed"] .dsh-sb-icon{color:var(--dsw-alias-state-warn-label,#d9843b)}',
    ].join('')

    /**
     * Install the stylesheet; returns the disposer.
     * @returns the remover.
     */
    function installStyles() {
      if (typeof document === 'undefined' || document.head === undefined || document.head === null) return function () {}
      var existing = document.getElementById(STYLE_ID)
      if (existing !== null && existing !== undefined) return function () {}
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLESHEET
      document.head.appendChild(style)
      return function () {
        if (style.parentNode !== undefined && style.parentNode !== null) style.parentNode.removeChild(style)
      }
    }

    /**
     * Register the Session "..." menu row.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => installStyles(), 'session-bridge: styles')
      ctx.effect(
        // `name` is what tells the client registry WHICH slot; `id`/`order` are
        // this slot's own cell fields. Without `name` the registry looks up the
        // slot named `undefined` and throws.
        () => ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: CELL_ID, order: ORDER }, SessionBridgeMenuItem)),
        'session-bridge: session menu row',
      )
    }

    exports.name = 'session-bridge'
    exports.apply = apply
    exports.inject = ['slots']
    exports.__internals = { copyText, expose, dictionary, translator, dismissMenu, ROUTE, STYLESHEET }
    return module.exports
  },
})
