// 用桩 React + 桩 DOM 真跑一遍客户端代码，把渲染出来的 HTML 抓下来，
// 生成一张静态预览图（preview.html）——样式与结构与插件在宿主里渲染的完全同源。
// 跑法：node dsh-worklog/scripts/preview.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const outFile = process.env.WL_OUT
  ? path.resolve(process.env.WL_OUT)
  : path.join(root, 'dsh-worklog', 'preview.html')

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const today = new Date()
const day = (delta) => {
  const d = new Date(today.getTime() + delta * 86400000)
  return ymd(d)
}

// —— 样例数据：完全虚构，覆盖本月，状态与优先级齐全 ——
const sample = [
  { id: 'a1', date: day(0), title: '跟完供应商合同', status: 'done', priority: 'normal', note: '法务已回，等盖章', project: '供应链改造', createdAt: '2026-10-20T01:00:00.000Z', doneAt: '2026-10-20T06:00:00.000Z' },
  { id: 'a2', date: day(0), title: '整理 Q4 交付清单', status: 'doing', priority: 'high', note: '还差三个团队的口径。数据平台那边说要把埋点表和交付表对齐后再给，供应链改造本周内会补上物流时效字段；另外财务口径要以 9 月结账后的版本为准，别用月中那版。', project: 'Q4 交付', createdAt: '2026-10-20T02:00:00.000Z' },
  { id: 'a3', date: day(0), title: '回访上周的候选供应商', status: 'todo', priority: 'high', note: '', project: '供应链改造', createdAt: '2026-10-20T03:00:00.000Z' },
  { id: 'a4', date: day(-1), title: '把埋点看板接进周报', status: 'done', priority: 'low', note: '', project: '数据平台', createdAt: '2026-10-19T01:00:00.000Z', doneAt: '2026-10-19T09:00:00.000Z' },
  { id: 'a5', date: day(-1), title: '评审 A/B 实验结论', status: 'done', priority: 'normal', note: '', project: '数据平台', createdAt: '2026-10-19T02:00:00.000Z', doneAt: '2026-10-19T05:00:00.000Z' },
  { id: 'a6', date: day(-2), title: '排期会 · 三组对齐', status: 'done', priority: 'normal', note: '结论：11/3 前冻结范围', project: 'Q4 交付', createdAt: '2026-10-18T01:00:00.000Z', doneAt: '2026-10-18T08:00:00.000Z' },
  { id: 'a7', date: day(-3), title: '财务口径对账', status: 'blocked', priority: 'high', note: '等财务系统导出权限', project: 'Q4 交付', createdAt: '2026-10-17T01:00:00.000Z' },
  { id: 'a8', date: day(-5), title: '上线灰度 10%', status: 'done', priority: 'normal', note: '', project: '供应链改造', createdAt: '2026-10-15T01:00:00.000Z', doneAt: '2026-10-15T11:00:00.000Z' },
  { id: 'a9', date: day(-8), title: '客户走访记录归档', status: 'done', priority: 'low', note: '', project: '内部运营', createdAt: '2026-10-12T01:00:00.000Z', doneAt: '2026-10-12T07:00:00.000Z' },
]

// —— 桩 React ——
const queuedEffects = []
const ReactStub = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: (fn) => { queuedEffects.push(fn) },
}

// —— 桩 DOM ——
function makeEl() {
  const handlers = []
  return {
    className: '',
    id: '',
    textContent: '',
    innerHTML: '',
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child },
    remove() {},
    contains() { return true },
    addEventListener(type, fn) { handlers.push({ type, fn }) },
    querySelector() { return null },
    /** 只为了预览：把记录下来的委托处理器按类型跑一遍 */
    dispatch(type, event) {
      for (const entry2 of handlers) {
        if (entry2.type === type) entry2.fn(event)
      }
    },
  }
}

// 客户端里用 `event.target instanceof Element` 判定，桩一个够用的 Element
globalThis.Element = class Element {}

const cssTags = []
let loaded = null
const win = {
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load(def) {
      loaded = def.factory((name) => {
        if (name === 'react') return ReactStub
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}
globalThis.window = win
globalThis.document = {
  getElementById() { return null },
  createElement() { return makeEl() },
  head: { appendChild(tag) { cssTags.push(tag) } },
}
// 设了 WL_DATA=<tasks.json 路径> 就用真实数据渲染，否则用上面的样例
const dataPath = process.env.WL_DATA
let tasks = sample
if (dataPath && fs.existsSync(dataPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    if (Array.isArray(parsed.tasks)) tasks = parsed.tasks
  } catch (err) {
    console.warn('WL_DATA 解析失败，回退到样例数据：' + String(err && err.message))
  }
}

globalThis.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (String(url).endsWith('/state') ? { ok: true, tasks } : { ok: true }),
})

const source = fs.readFileSync(path.join(root, 'dsh-worklog/client/client.js'), 'utf8')
new Function('window', source)(win)

const registry = []
loaded.apply({
  effect(cb) { cb() },
  slots: {
    inject(_n, cb) { return cb() },
    register(config, Component) { registry.push({ config, Component }); return () => {} },
  },
})

const entry = registry.find((item) => item.config.name === 'settings.section')
if (!entry) throw new Error('没有拿到 settings.section 组件')

// 渲染：Pane → WorklogMount → div(ref) → useEffect 里 mountWorklog 往 div 里塞 DOM
const paneElement = entry.Component({})
const mountElement = paneElement.type(paneElement.props)
const host = makeEl()
mountElement.props.ref.current = host
for (const effect of queuedEffects.splice(0)) effect()
await new Promise((resolve) => setTimeout(resolve, 120))

const panel = host.children[0]
if (!panel) throw new Error('面板没有渲染出来')
const css = cssTags.length ? cssTags[0].textContent : ''

function clickAct(act, attrs) {
  const node = {
    getAttribute(name) {
      if (name === 'data-act') return act
      return (attrs && attrs[name]) || ''
    },
  }
  node.closest = () => node
  const target = Object.assign(new globalThis.Element(), node)
  panel.dispatch('click', { target, preventDefault() {} })
}

// 需要看上月时：WL_MONTH_PREV=2 就往回翻两个月
const monthsBack = Number(process.env.WL_MONTH_PREV || 0)
for (let i = 0; i < monthsBack; i += 1) clickAct('prev')

// WL_VIEW=open|all 时，模拟点一下下面的视图标签
if (process.env.WL_VIEW) clickAct('view', { 'data-view': process.env.WL_VIEW })

// WL_DAY=2026-10-14 时，模拟点一下日历上的那一天
if (process.env.WL_DAY) clickAct('day', { 'data-date': process.env.WL_DAY })

// WL_NOTE=任务 id 时，模拟点一下那条备注（展开长备注）
if (process.env.WL_NOTE) clickAct('note', { 'data-id': process.env.WL_NOTE })

const defaultHtml = panel.innerHTML

// 再模拟点一下「管理项目」，拿到展开后的样子
if (defaultHtml.indexOf('管理项目') >= 0) {
  clickAct('manage-toggle')
}
const manageHtml = panel.innerHTML

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8" />
<title>dsh-worklog 预览</title>
<style>
  body { margin: 0; padding: 28px; background: #f6f7f9; color: #1c1f26; font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .frame { width: 460px; max-width: 100%; margin: 0 auto 22px; background: #fff; border: 1px solid rgba(0,0,0,.08); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.08); overflow: hidden; }
  .frame-head { padding: 8px 12px; font-size: 11px; letter-spacing: .4px; text-transform: uppercase; color: #8b93a7; border-bottom: 1px solid rgba(0,0,0,.06); }
  .note { max-width: 460px; margin: 14px auto 0; font-size: 11.5px; color: #8b93a7; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #e7e9ee; }
    .frame { background: #1d2026; border-color: rgba(255,255,255,.1); box-shadow: none; }
    .note { color: #8b93a7; }
  }
${css}
</style>
<div class="frame">
  <div class="frame-head">工作记录 · 默认视图（与插件同一份 CSS 与 DOM）</div>
  <div class="${panel.className}">${defaultHtml}</div>
</div>
<div class="frame">
  <div class="frame-head">工作记录 · 展开「管理项目」</div>
  <div class="${panel.className}">${manageHtml}</div>
</div>
<div class="note">这是由真实客户端代码渲染出的快照；交互要在 DSH 里重启应用后才可用。</div>
</html>
`

fs.writeFileSync(outFile, html, 'utf8')
console.log('wrote ' + outFile)
console.log('default bytes: ' + defaultHtml.length + ', manage bytes: ' + manageHtml.length)
