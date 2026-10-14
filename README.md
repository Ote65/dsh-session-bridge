# dsh-session-bridge

**Hand one DeepSeek Harness session to another Agent — and let it read, and act, from anywhere.**

> 📽️ **Animated introduction:** open [`docs/index.html`](docs/index.html) in a browser.
> No build, no dependencies — one self-contained file that loops through the whole
> flow: open `⋯` → **Expose session** → the handoff prompt lands on your clipboard →
> Codex / Trae connects over loopback HTTP → reads the transcript → sees the pending
> question → answers it → **reports back and stops**.

[![test](https://github.com/OWNER/dsh-session-bridge/actions/workflows/test.yml/badge.svg)](https://github.com/OWNER/dsh-session-bridge/actions/workflows/test.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4176e6)

A DeepSeek Harness (DSH) session usually lives behind the desktop UI. This plugin
publishes **one** session over a loopback HTTP bridge and puts a paste-ready handoff
prompt on your clipboard, so Codex, Trae, or any other Agent can:

- **see the conversation** — the full event log, incrementally, from any `seq`
- **see whether it is running** — live status plus the current event cursor
- **see what it is blocked on** — the pending `ask_user_question` with its options
- **choose an option** — the answer is steered back in as a user message, so the session resumes
- **run a slash command** — `/compact`, `/goal`, and anything else the session accepts
- **know when to stop** — the prompt tells the receiving Agent to read, report, and stop

```
        ┌─────────────── DSH (desktop) ───────────────┐
        │  Session row   ⋯  →  "Expose session"       │
        │        │                                    │
        │        ▼  copies a handoff prompt           │
        │   clipboard ────────────────────────────┐   │
        │        │                               │   │
        │        ▼                               ▼   │
        │   ┌────────────────────────────────────────┐│
        │   │  loopback bridge  127.0.0.1:19388      ││
        │   │  /info /status /transcript /pending     ││
        │   │  /answer /command            (POST)     ││
        │   └────────────────────────────────────────┘│
        └───────────────────┬─────────────────────────┘
                            │  plain HTTP, no cookie, no header
                            ▼
                  ┌───────────────────┐
                  │  Codex / Trae / … │  reads, decides, answers, stops
                  └───────────────────┘
```

---

## Install

### One paste, and the Harness installs it for you

Copy the prompt below into DSH (replace `OWNER` with the GitHub account that hosts the
repo). It makes DSH find the repository, install the plugin into the active profile,
verify the result, and **star the repository**. The landing page ships the same block
behind a copy button.

<sub>This block is intentionally in Chinese: it is the text you paste into the Harness.
Everything else in this repository is English.</sub>

```text
请把 DeepSeek Harness 插件 `dsh-session-bridge` 从 GitHub 安装到当前 profile，并给这个仓库点一个 star。

仓库地址：https://github.com/OWNER/dsh-session-bridge

1. 先读仓库的 README，然后按当前 profile 安装第三方 bundle 的**正规方式**安装它。
   桌面 profile 走插件管理器的 bundle 安装，不要手工改 profile 的配置文件。
2. 验证：左侧会话栏任意会话行的 "..." 菜单里应多出一行。
   如果插件管理器报 "did not activate"，立刻停下并把完整报错发我，不要自己猜着改配置。
3. 安装成功后，在 GitHub 上给这个仓库点 star（例如
   `gh api -X PUT /user/starred/OWNER/dsh-session-bridge`），并告诉我 star 是否成功。

不要 push、不要发布、不要开 PR，除非我明确要求。
```

### Manual (desktop profile)

```bash
git clone https://github.com/OWNER/dsh-session-bridge.git
```

Then add the bundle through the profile's plugin manager, pointing at the checkout
(or add a `link:` dependency plus the bundle name to the profile's `package.json`).
The plugin ships two halves — `lib/index.js` (Host) and `lib/client.js` (Client) —
and `cordis.patch.yml` inserts its single row.

**Restart DSH after the first install.** The Host half is a Node module and is not
reliably hot-reloaded; the Client half is.

---

## Use

1. Hover any session row in the left sidebar and open its **`⋯`** menu.
2. Choose **Expose session** (the row between *Fork* and *Archive*).
3. The row turns green — **Copied** — and a handoff prompt is on your clipboard.
4. Paste it into the other Agent.

The prompt begins with the contract:

```text
⚠️ Read first, decide once, stop after reading.
  · GET the discovery document. HTTP 200 means you are connected.
  · GET the transcript and understand the context.
  · GET the pending question; if there is one, answer it with POST.
  · Then STOP and report back to your user — do not fire off commands on your own.
  · On 401/404/unreachable: stop too, report the status code, and do not go looking
    for the auth implementation, other URLs, or open ports. That path is a dead end.
```

---

## API

Everything is reachable with `curl` — **no cookie, no header, no token**. The bridge id
in the URL *is* the credential.

| Route | Method | Purpose |
|---|---|---|
| `/session-bridge/expose?sessionId=…` | GET | mint (or reuse) an exposure; returns the discovery document + prompt |
| `/session-bridge/info?bridge=…` | GET | discovery document (cwd, model, `seq`, endpoints) |
| `/session-bridge/status?bridge=…` | GET | live? running? current `seq` |
| `/session-bridge/transcript?bridge=…&since=N` | GET | the conversation, incrementally |
| `/session-bridge/pending?bridge=…` | GET | the pending question **with its options**, or `null` |
| `/session-bridge/answer` | POST | `{ bridge, callId?, answers: [{ id, selected: [label], custom? }] }` |
| `/session-bridge/command` | POST | `{ bridge, line: "/compact" }` |
| `/session-bridge/revoke?bridge=…` | GET | drop one exposure |

### The cursor contract

`Session.snapshotEvents(fromSeq, toSeqExclusive)` is **half-open**, and `session.seq`
is the **next** offset (one past the last event). So:

> Send the `seq` from one response back as the next request's `since`.

No `+1`, no guessing.

### Example

```bash
curl "http://127.0.0.1:19388/session-bridge/info?bridge=$BRIDGE"
curl "http://127.0.0.1:19388/session-bridge/transcript?bridge=$BRIDGE&since=0"
curl "http://127.0.0.1:19388/session-bridge/pending?bridge=$BRIDGE"
curl -X POST "http://127.0.0.1:19388/session-bridge/answer" \
  -H 'content-type: application/json' \
  -d "{\"bridge\":\"$BRIDGE\",\"answers\":[{\"id\":\"1\",\"selected\":[\"Submit first\"]}]}"
```

---

## How it works (and the traps it avoids)

### Its own loopback listener, not DSH's web server

DSH's web server gives a plugin exactly two outcomes, and neither is usable by an
outside caller:

| Registered at | What an external `curl` gets |
|---|---|
| outside `/api` | **404** — only the `/api` subtree is dispatched to plugin routes |
| inside `/api` | **401 `unauthorized`** — behind the renderer's signed-cookie gate |

So the bridge runs **its own `node:http` listener** on `127.0.0.1:19388`, sets
`access-control-allow-origin` (the renderer lives on `dsh-app://app/`, so its call is
cross-origin), and treats the 128-bit bridge id as the capability.

### The self-check is a real socket

Before a prompt is handed over, `/expose` fetches **its own URL over a real TCP
connection** and refuses to answer unless it gets `200`. An earlier build used the
Host's global `fetch`, which can be served internally and reported `200` for a URL no
external process could reach — a false green that shipped a dead link. The self-check
is deliberately `node:http`, and the failure is surfaced as `HTTP <code>` in the row's
tooltip instead of a broken handoff.

### What is *not* here

**Free-text prompts.** `subagents.prompt` looks like the door, but its contract is
parent↔child only (`parentSessionId` + `childSessionId` + `mode: 'continuable'`), and
an outside Agent is neither. The remaining path is the Client half's composer
(`inputActions`), driven by a poll of this bridge. Until then, `/answer` is how an
external Agent writes into a blocked session — the reply is steered in as a user
message, which also resumes it.

### Read/write surface

| Write | Backed by |
|---|---|
| answer options | `userQuestions.answer(agent, callId, { answers })` |
| run a slash command | `commands.execute(agent, line, [], signal)` |

Both take an arbitrary live **root agent**, obtained with `ctx.agents.get(sessionId)`.

---

## Security

- Binds **`127.0.0.1` only**. Nothing is exposed to the LAN.
- The **URL is the credential**: 16 random bytes (128 bits), never the raw session id.
  An exposed URL cannot be used to enumerate or address other sessions.
- **Exposure is in memory.** It dies with the plugin; nothing is persisted.
- `/revoke` drops an exposure immediately.
- While exposed, a caller who has the URL can read the whole transcript **and** answer
  the session's questions. Treat a handoff prompt like a password, and revoke when the
  handover is done.

---

## Configuration

Add a `config` block to the bundle row in the profile patch:

```yaml
- id: session-bridge
  config:
    port: 19388                                       # loopback listener
    baseUrl: http://127.0.0.1:19388                   # what the handoff prompt advertises
    sessionProjectionDir: ''                          # optional; read only for the session title
```

> Do **not** export a `Config` object from the plugin. Cordis' `resolveConfig` expects a
> schema with `validate` (Zod-like); a plain object makes activation fail with an error
> whose stack points only into Cordis. The shipped plugins read config defensively in
> `apply(ctx, config = {})` instead — this one does the same.

---

## Tests

```bash
npm test          # 31 checks: host 12 + client 19, no network
npm run test:live # mounts the real handlers on a real port and drives them over HTTP
```

Covered: the eight routes, the exposure lifecycle, the discovery document, the
incremental transcript and its cursor contract, `pendingQuestion` derivation, the
self-check rollback (a URL that is not `200` is never handed over), service-unavailable
and not-live paths, the keyed menu registration and its `name` field, the radar glyph
(four primitives, no emoji), the clipboard write and its fallback, and the
dismiss-the-menu-only-after-confirming behaviour.

CI runs both suites on Node 22 and 24.

---

## Repository layout

```
dsh-session-bridge/
├── lib/
│   ├── index.js        Host half — the loopback listener, the eight routes
│   └── client.js       Client half — the "⋯" menu row, the radar glyph, the clipboard
├── tests/
│   ├── run.mjs         the suites
│   ├── host.test.mjs   routes, exposure lifecycle, cursor contract, self-check
│   ├── client.test.mjs menu seat, glyph, clipboard, menu dismissal
│   └── live.mjs        mounts the real handlers on a real port and drives them over HTTP
├── docs/
│   └── index.html      the animated introduction (self-contained)
├── cordis.patch.yml    the single bundle row
└── package.json
```

---

## License

[MIT](LICENSE)
