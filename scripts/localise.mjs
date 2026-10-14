/**
 * Localise docs/index.html: English copy -> Chinese, and put the install prompt
 * back into English. Styles and structure are untouched.
 *
 *   node scripts/localise.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../docs/index.html', import.meta.url)
let html = readFileSync(file, 'utf8')

/** [english, chinese] — every pair must match exactly once. */
const pairs = [
  ['<html lang="en">', '<html lang="zh-CN">'],
  ['<title>dsh-session-bridge — hand a DeepSeek Harness session to another Agent</title>',
    '<title>dsh-session-bridge — 把一个 DeepSeek Harness 会话交给别的 Agent</title>'],
  ['content="A DeepSeek Harness plugin that publishes one session over a loopback HTTP bridge and puts a paste-ready handoff prompt on your clipboard, so Codex, Trae or any other Agent can read it, answer its questions, and stop."',
    'content="一个 DeepSeek Harness 插件：把单个会话通过环回 HTTP 桥对外发布，并往剪贴板放一段现成的交接提示词，让 Codex、Trae 或任何别的 Agent 能读懂它、替它做选择，然后停下。"'],

  // header
  ['<span class="kicker"><span class="dot"></span> DeepSeek Harness plugin · MIT</span>',
    '<span class="kicker"><span class="dot"></span> DeepSeek Harness 插件 · MIT</span>'],
  ['<h1>Hand a session to <span>another Agent</span></h1>',
    '<h1>把一个会话<wbr>交给 <span>另一个 Agent</span></h1>'],
  ['One row in the session menu. One click. Your clipboard gets a paste-ready prompt, and\n    Codex, Trae or any other Agent can read that session — its conversation, whether it is\n    running, what it is blocked on — <strong>and answer it</strong>.',
    '会话菜单里多一行 ✓，点一下 ✓，剪贴板里就有一段现成的提示词 ✓。\n    于是 Codex、Trae 或任何别的 Agent 都能读懂这个会话 —— 它的对话 ✓、它是否在跑 ✓、\n    它卡在什么问题上 ✓ —— <strong>并且替它做出选择</strong> ✓。'],
  ['<span class="badge">no cookie · no header · URL is the credential</span>',
    '<span class="badge">不要 cookie · 不要 header · URL 本身就是凭证</span>'],
  ['<span class="badge">31/31 tests</span>', '<span class="badge">测试 31/31</span>'],
  ['<a class="btn primary" href="#install">Install</a>', '<a class="btn primary" href="#install">安装</a>'],
  ['<a class="btn" href="#api">API</a>', '<a class="btn" href="#api">接口</a>'],
  ['<a class="btn" href="#how">How it works</a>', '<a class="btn" href="#how">原理</a>'],

  // the stage
  ['<h2>What it does</h2>', '<h2>它做了什么</h2>'],
  ['<p class="sub">An 18-second loop. Watch the packets.</p>',
    '<p class="sub">18 秒一轮循环，注意看那些数据包 ✓。</p>'],
  ['<span class="title">Rendering kernel migration</span>', '<span class="title">渲染内核迁移</span>'],
  ['<span class="title">Official site update</span>', '<span class="title">官网更新</span>'],
  ['<span class="title">Multi-core renderer</span>', '<span class="title">多核渲染</span>'],
  ['<div class="mi">Pin</div>', '<div class="mi">置顶</div>'],
  ['<div class="mi">Rename</div>', '<div class="mi">重命名</div>'],
  ['<div class="mi">Fork</div>', '<div class="mi">派生</div>'],
  ['            Expose session\n', '            暴露会话\n'],
  ['<div class="mi">Archive</div>', '<div class="mi">归档</div>'],
  ['<div class="toast">✓ Copied — handoff prompt on the clipboard</div>',
    '<div class="toast">✓ 已复制 —— 交接提示词在剪贴板里</div>'],
  ['<div class="who"><span class="avatar">AI</span> external Agent</div>',
    '<div class="who"><span class="avatar">AI</span> 外部 Agent</div>'],
  ['            handoff prompt pasted ✓<br>\n            <span style="color:var(--fg3)">read → decide → stop</span>',
    '            已粘入交接提示词 ✓<br>\n            <span style="color:var(--fg3)">先读 → 再决定 → 然后停</span>'],
  ['            reading <code>/transcript</code> …<br>\n            128 events · cwd <code>E:\\OltraZ1.1</code>',
    '            正在读 <code>/transcript</code> …<br>\n            128 条事件 · 工作目录 <code>E:\\OltraZ1.1</code>'],
  ['<div class="q">The worker has uncommitted changes — what should it do?</div>',
    '<div class="q">有未提交的改动，该怎么处理？</div>'],
  ['<div class="opt">Use --allow-dirty</div>', '<div class="opt">用 --allow-dirty 强发</div>'],
  ['<div class="opt chosen">✓ Commit it first, then release</div>',
    '<div class="opt chosen">✓ 先提交，再发布</div>'],
  ['<div class="final">✓ reported to the user — stopped</div>',
    '<div class="final">✓ 已向用户汇报 —— 停下</div>'],
  ['<b>read</b> /info /status /transcript /pending<br>', '<b>只读</b> /info /status /transcript /pending<br>'],
  ['<b>write</b> /answer /command', '<b>可写</b> /answer /command'],

  // captions
  ['<p class="cap"><b>1 ·</b> Hover a session row and open its <b>⋯</b> menu.</p>',
    '<p class="cap"><b>1 ·</b> 鼠标划过会话行，点开它的 <b>⋯</b> 菜单。</p>'],
  ['<p class="cap"><b>2 ·</b> Choose <b>Expose session</b> — a bridge is minted for exactly that session.</p>',
    '<p class="cap"><b>2 ·</b> 选 <b>暴露会话</b> —— 系统只为这一个会话铸造一座桥。</p>'],
  ['<p class="cap"><b>3 ·</b> A handoff prompt lands on your <b>clipboard</b>. No token to copy.</p>',
    '<p class="cap"><b>3 ·</b> 交接提示词落进<b>剪贴板</b> ✓，没有任何需要你手动复制的 token ✓。</p>'],
  ['<p class="cap"><b>4 ·</b> Paste it into Codex / Trae. The URL <em>is</em> the credential.</p>',
    '<p class="cap"><b>4 ·</b> 把它粘给 Codex / Trae ✓ —— 那个 URL <em>本身</em>就是凭证 ✓。</p>'],
  ['<p class="cap"><b>5 ·</b> The Agent reads <code>/info</code> → <code>/transcript</code> → <code>/pending</code>, and sees the question.</p>',
    '<p class="cap"><b>5 ·</b> 它依次读 <code>/info</code> → <code>/transcript</code> → <code>/pending</code> ✓，看到了那个待答问题 ✓。</p>'],
  ['<p class="cap"><b>6 ·</b> It answers with <b>POST /answer</b> — the session resumes — then reports back and <b>stops</b>.</p>',
    '<p class="cap"><b>6 ·</b> 它用 <b>POST /answer</b> 做出选择 ✓ —— 会话继续跑 ✓ —— 然后向你汇报并<b>停下</b> ✓。</p>'],

  // why
  ['<h2>Why it is built this way</h2>', '<h2>为什么这样设计</h2>'],
  ['<p class="sub">Two traps this plugin exists to avoid.</p>',
    '<p class="sub">这个插件存在的意义，就是绕开两个坑 ✓。</p>'],
  ['<h4>Its own listener</h4>', '<h4>自己起监听</h4>'],
  ['<p>DSH\'s web server answers an outside caller with <b>404</b> outside <code>/api</code> and\n      <b>401 unauthorized</b> inside it. So the bridge runs its own <code>node:http</code> listener\n      on loopback, and the URL carries the capability.</p>',
    '<p>DSH 自己的 web server 对外部调用者只有两种回应：不在 <code>/api</code> 下给 <b>404</b> ✓，\n      在 <code>/api</code> 下给 <b>401 unauthorized</b> ✗。所以这座桥自己起了一个 <code>node:http</code>\n      监听，只绑环回 ✓，能力由 URL 承载 ✓。</p>'],
  ['<h4>A real self-check</h4>', '<h4>真 socket 自检</h4>'],
  ['<p>Before handing over a prompt, <code>/expose</code> fetches its own URL over a\n      <b>real TCP socket</b>. If it is not <code>200</code>, no prompt is copied — you get the\n      status code instead of a dead link.</p>',
    '<p>交出提示词之前 ✓，<code>/expose</code> 会通过<b>真实 TCP 连接</b>去请求自己那个 URL ✓。\n      不是 <code>200</code> 就不复制提示词 ✗ —— 你拿到的是状态码 ✓，而不是一条死链 ✗。</p>'],
  ['<h4>It tells the Agent to stop</h4>', '<h4>它会叫对方停下</h4>'],
  ['<p>The prompt is explicit: read, report, stop. Do not hunt for the auth implementation,\n      guess other URLs, or scan ports — that is a dead end that burns tokens.</p>',
    '<p>提示词里写得很明确 ✓：先读 ✓、汇报 ✓、停下 ✓。不要去反查鉴权实现 ✗、不要猜别的 URL ✗、\n      不要扫端口 ✗ —— 那是死胡同 ✓，只会烧光额度 ✗。</p>'],

  // api
  ['<h2>API</h2>\n  <p class="sub">Everything is reachable with <code>curl</code>. No cookie, no header, no token.</p>',
    '<h2>接口</h2>\n  <p class="sub">全部可以用 <code>curl</code> 直接打 ✓。不要 cookie ✓、不要 header ✓、不要 token ✓。</p>'],
  ['<thead><tr><th>Route</th><th>Method</th><th>Purpose</th></tr></thead>',
    '<thead><tr><th>路由</th><th>方法</th><th>作用</th></tr></thead>'],
  ['<td>mint (or reuse) an exposure; returns the discovery document + prompt</td>',
    '<td>铸造（或复用）一个暴露 ✓，返回发现文档 + 交接提示词</td>'],
  ['<td>discovery document — cwd, model, <code>seq</code>, endpoints</td>',
    '<td>发现文档 —— 工作目录 ✓、模型 ✓、<code>seq</code> ✓、各接口地址</td>'],
  ['<td>live? running? current <code>seq</code></td>', '<td>还活着吗 ✓ 在跑吗 ✓ 当前 <code>seq</code></td>'],
  ['<td>the conversation, incrementally</td>', '<td>会话记录 ✓ 支持增量</td>'],
  ['<td>the pending question <b>with its options</b>, or <code>null</code></td>',
    '<td>它卡住的<b>那个问题连同选项</b> ✓，没有就是 <code>null</code></td>'],
  ['<td>drop one exposure</td>', '<td>撤销一个暴露</td>'],
  ['<p class="note">Cursor contract: send the <code>seq</code> from one response back as the next request\'s\n    <code>since</code>. <code>snapshotEvents</code> is half-open and <code>session.seq</code> is the next offset — no <code>+1</code>, no guessing.</p>',
    '<p class="note">游标契约 ✓：把上一次响应里的 <code>seq</code> 原样作为下一次的 <code>since</code> 传回来 ✓。\n    <code>snapshotEvents</code> 是半开区间 ✓，而 <code>session.seq</code> 是<b>下一个偏移</b> —— 不用 <code>+1</code> ✓，也不用猜 ✓。</p>'],

  // install
  ['<h2>Install</h2>', '<h2>安装</h2>'],
  ['<p class="sub">Paste this into DeepSeek Harness. It installs the plugin from GitHub <b>and stars the repo</b>.</p>',
    '<p class="sub">把下面这段粘进 DeepSeek Harness ✓。它会从 GitHub 装好插件 ✓，<b>并给仓库点 star</b> ✓。</p>'],
  ['<p class="note" style="margin:0 0 10px">The block below is in Chinese on purpose — it is the text you paste into the Harness. The rest of this page is English.</p>',
    '<p class="note" style="margin:0 0 10px">下面这段提示词<b>故意用英文</b> ✓ —— 它是喂给 Agent 的指令 ✓，英文在模型侧更稳 ✓。页面其它部分才是给你看的中文 ✓。</p>'],
  ['<span>install-prompt.txt</span>', '<span>安装提示词 · install-prompt.txt</span>'],
  ['<button class="btn" id="copyBtn" type="button">Copy</button>',
    '<button class="btn" id="copyBtn" type="button">复制</button>'],

  // the prompt itself: back to English
  ['请把 DeepSeek Harness 插件 `dsh-session-bridge` 从 GitHub 安装到当前 profile，并给这个仓库点一个 star。\n\n仓库地址：https://github.com/OWNER/dsh-session-bridge\n\n1. 先读仓库的 README，然后按当前 profile 安装第三方 bundle 的**正规方式**安装它。\n   桌面 profile 走插件管理器的 bundle 安装，不要手工改 profile 的配置文件。\n2. 验证：左侧会话栏任意会话行的 "..." 菜单里应多出一行。\n   如果插件管理器报 "did not activate"，立刻停下并把完整报错发我，不要自己猜着改配置。\n3. 安装成功后，在 GitHub 上给这个仓库点 star（例如\n   `gh api -X PUT /user/starred/OWNER/dsh-session-bridge`），并告诉我 star 是否成功。\n\n不要 push、不要发布、不要开 PR，除非我明确要求。',
    'Install the DeepSeek Harness plugin `dsh-session-bridge` from the repository below, then star it.\n\nrepository: https://github.com/OWNER/dsh-session-bridge\n\n1. Read the repository README first, then install it into the ACTIVE profile the same way\n   that profile installs third-party bundles. On the desktop profile that is the plugin\n   manager\'s bundle install - do not hand-edit the profile\'s config files.\n2. Verify: the "..." menu of a session row in the left sidebar gains one more row.\n   If the plugin manager reports "did not activate", stop and report the exact error\n   instead of guessing at the configuration.\n3. Once installed, star the repository on GitHub (for example\n   `gh api -X PUT /user/starred/OWNER/dsh-session-bridge`) and say whether the star succeeded.\n\nDo not push, publish, or open a pull request unless I ask.'],

  ['<p class="note">Replace <code>OWNER</code> with the GitHub account hosting the repository.\n    Restart DSH after the first install: the Host half is a Node module and is not reliably hot-reloaded.</p>',
    '<p class="note">把 <code>OWNER</code> 换成托管仓库的那个 GitHub 账号 ✓。\n    首次安装后请重启 DSH ✓：Host 半区是 Node 模块 ✓，热重载不可靠 ✗。</p>'],
  ['<div>MIT licensed · built for DeepSeek Harness (<code>0.2.0-rc.2</code>)<br>\n    binds <code>127.0.0.1</code> only · exposures are in-memory and revocable</div>',
    '<div>MIT 协议 · 为 DeepSeek Harness（<code>0.2.0-rc.2</code>）而做<br>\n    只绑 <code>127.0.0.1</code> · 暴露是内存态 ✓ 随时可撤销 ✓</div>'],
]

let applied = 0
const missed = []
for (const [from, to] of pairs) {
  const at = html.indexOf(from)
  if (at < 0) { missed.push(from.slice(0, 70)); continue }
  html = html.slice(0, at) + to + html.slice(at + from.length)
  applied += 1
}

writeFileSync(file, html, 'utf8')
console.log(`applied ${applied}/${pairs.length}`)
for (const miss of missed) console.log(`  MISSED: ${miss}`)
if (missed.length > 0) process.exitCode = 1

const left = [...html.matchAll(/>([A-Za-z][A-Za-z ,.'’\-]{6,})</g)]
  .map((m) => m[1].trim())
  .filter((text) => /^(Hand|What|Why|Install|Copy|Paste|Hover|Choose|The |It |Once|Do not|Read|Verify|Star)/.test(text))
console.log('english-looking visible strings left:', left.length)
for (const text of left.slice(0, 10)) console.log(`  ${text}`)
