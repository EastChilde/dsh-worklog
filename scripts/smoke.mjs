// dsh-worklog 冒烟测试（不需要 DSH 宿主）：
//   1. 服务端：假 ctx 拿到路由 → 真起一个 http server → 增删改查跑一遍（数据落在临时 DSH_HOME）
//   2. 客户端：桩掉 window / document / react，加载 client.js，确认 apply() 能注册 4 个槽位
// 跑法：node dsh-worklog/scripts/smoke.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const root = path.resolve(process.cwd())
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshwl-'))
process.env.DSH_HOME = tmp

let failed = 0
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   [' + extra + ']' : ''))
  if (!cond) failed += 1
}

// ---------- 1. 服务端 ----------
const plugin = (await import(pathToFileURL(path.join(root, 'dsh-worklog/lib/index.js')).href)).default
const routes = []
const toolDefs = []
plugin.apply({
  effect(cb) { cb() },
  // 按 cordis 的语义：哪个服务到位，回调里就只给哪个
  inject(services, cb) {
    const ctx = {}
    if (services.indexOf('webServer') >= 0) {
      ctx.webServer = { register(route) { routes.push(route); return () => {} } }
    }
    if (services.indexOf('tools') >= 0) {
      ctx.tools = { register(definition) { toolDefs.push(definition); return () => {} } }
    }
    cb(ctx)
  },
})
await new Promise((resolve) => setTimeout(resolve, 60))
check('注册了 6 条路由', routes.length === 6, routes.map((r) => r.path).join(', '))
check('经 index.js 注册了 4 个 Agent 工具', toolDefs.length === 4, toolDefs.map((t) => t.name).join(','))

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const route = routes.find((r) => r.path === url.pathname)
  if (!route) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  Promise.resolve(route.handler(req, res)).catch((err) => {
    res.writeHead(500)
    res.end(String(err && err.message))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function call(pathname, body) {
  const init = body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const res = await fetch(base + pathname, init)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

let r = await call('/dsh-worklog/state')
check('初始为空', r.status === 200 && Array.isArray(r.json.tasks) && r.json.tasks.length === 0)

r = await call('/dsh-worklog/reload')
check('热重载核心模块', r.status === 200 && r.json.ok === true && !!r.json.reloadedAt, r.json.reloadedAt)

r = await call('/dsh-worklog/state')
check('重载后路由仍然可用', r.status === 200 && Array.isArray(r.json.tasks))

r = await call('/dsh-worklog/task', { title: '跟完供应商合同', date: '2026-10-20', status: 'done', note: '法务已回', project: '  供应链   改造 ' })
check('新建任务（含 doneAt）', r.status === 200 && !!r.json.task.id && !!r.json.task.doneAt, JSON.stringify(r.json).slice(0, 120))
check('项目名空白归一', r.json.task.project === '供应链 改造', r.json.task.project)
const id = r.json.task && r.json.task.id

r = await call('/dsh-worklog/task', { id, status: 'doing' })
check('改回进行中会清空 doneAt', r.status === 200 && r.json.task.status === 'doing' && r.json.task.doneAt === null)

r = await call('/dsh-worklog/task', { id, title: '  跟完   供应商合同  ' })
check('标题做空白归一', r.json.task.title === '跟完 供应商合同', r.json.task.title)
check('未改 project 时保留原值', r.json.task.project === '供应链 改造', r.json.task.project)

r = await call('/dsh-worklog/task', { id, project: '' })
check('项目可以清空（→ 未归类）', r.json.task.project === '')

r = await call('/dsh-worklog/task', { title: '   ' })
check('空标题被拒（400）', r.status === 400)

r = await call('/dsh-worklog/task', { title: '写周报', date: '2026-10-20', project: '内部运营' })
check('第二个项目', r.status === 200 && r.json.task.project === '内部运营')

r = await call('/dsh-worklog/state')
check('已持久化（2 条）', r.json.tasks.length === 2)
check('落盘带上 project 字段', r.json.tasks.every((t) => typeof t.project === 'string'))

const file = path.join(tmp, 'dsh-worklog', 'tasks.json')
check('落盘文件存在', fs.existsSync(file), file)
check('落盘 JSON 可解析', (() => { try { JSON.parse(fs.readFileSync(file, 'utf8')); return true } catch { return false } })())

r = await call('/dsh-worklog/task/delete', { id })
check('删除任务', r.status === 200)
r = await call('/dsh-worklog/state')
check('删除后剩 1 条', r.json.tasks.length === 1)

// —— 项目改名 / 删除 ——
r = await call('/dsh-worklog/project/rename', { from: '内部运营', to: '运营中台' })
check('项目改名搬动全部任务', r.status === 200 && r.json.moved === 1, JSON.stringify(r.json))
r = await call('/dsh-worklog/state')
check('任务上是新项目名', r.json.tasks[0].project === '运营中台')

r = await call('/dsh-worklog/project/rename', { from: '运营中台', to: '   ' })
check('改成空名被拒', r.status === 400)

r = await call('/dsh-worklog/project/delete', { name: '运营中台' })
check('删项目把任务退回未归类', r.status === 200 && r.json.moved === 1)
r = await call('/dsh-worklog/state')
check('任务还在，只是没项目了', r.json.tasks.length === 1 && r.json.tasks[0].project === '')

server.close()

// ---------- 1b. 程序化 API + Agent 工具 ----------
const coreUrl = pathToFileURL(path.join(root, 'dsh-worklog/lib/core.js')).href
const core = await import(coreUrl)
const created = core.saveTask({ title: '写周报', project: '测试项目', date: '2026-10-20' })
check('saveTask 直接可用', !!created.id && created.project === '测试项目')
check('listTasks 关键词命中', core.listTasks({ keyword: '周报' }).total >= 1)
const summary = core.projectSummary()
check('projectSummary 出统计', summary.length === 1 && summary[0].done === 0, JSON.stringify(summary))

const toolsUrl = pathToFileURL(path.join(root, 'dsh-worklog/lib/tools.js')).href
const { registerWorklogTools } = await import(toolsUrl)
const registered = []
const disposeTools = await registerWorklogTools({
  tools: { register(definition) { registered.push(definition); return () => {} } },
}, () => core)
check('注册 4 个 Agent 工具', registered.length === 4, registered.map((t) => t.name).join(','))
check('工具定义带描述与参数', registered.every((t) => typeof t.description === 'string' && t.description.length > 20 && typeof t.execute === 'function'))

const addTool = registered.find((t) => t.name === 'worklog_add')
const added = await addTool.execute({ title: '对话里记一条', project: '测试项目' }, {})
check('worklog_add 能落库', !!added.id && added.project === '测试项目', JSON.stringify(added))
check('worklog_add 有文本渲染', addTool.output.render({}, added)[0].text.indexOf('对话里记一条') >= 0)

const listTool = registered.find((t) => t.name === 'worklog_list')
const listed = await listTool.execute({ project: '测试项目' }, {})
check('worklog_list 返回汇总', listed.count === 2 && listed.summary.indexOf('对话里记一条') >= 0, listed.summary)

const updateTool = registered.find((t) => t.name === 'worklog_update')
const updated = await updateTool.execute({ id: added.id, status: 'done' }, {})
check('worklog_update 改状态', updated.status === 'done')

const projectsTool = registered.find((t) => t.name === 'worklog_projects')
const projects = await projectsTool.execute({}, {})
check('worklog_projects 出汇总', projects.count === 1 && projects.summary.indexOf('测试项目') >= 0)

disposeTools.dispose()

// ---------- 2. 客户端 ----------
const ReactStub = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
}

let loaded = null
const cssTags = []
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
  createElement() { return { id: '', textContent: '' } },
  head: { appendChild(tag) { cssTags.push(tag) } },
}
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) })

const source = fs.readFileSync(path.join(root, 'dsh-worklog/client/client.js'), 'utf8')
try {
  new Function('window', source)(win)
} catch (err) {
  check('client.js 可加载', false, String(err && err.message))
}

check('模块 id 正确', !!loaded && loaded.name === 'dsh-worklog')
check('inject 只需要 slots', !!loaded && Array.isArray(loaded.inject) && loaded.inject.join(',') === 'slots')

const slots = []
const components = []
const ctx = {
  effect(cb) { cb() },
  slots: {
    inject(_name, cb) { return cb() },
    register(config, Component) {
      slots.push(config.name + ':' + (config.key || config.id || ''))
      components.push(Component)
      return () => {}
    },
  },
}

try {
  loaded.apply(ctx)
  check('apply() 不抛错', true)
} catch (err) {
  check('apply() 不抛错', false, String(err && err.message))
}

check('注册了 4 个槽位', slots.length === 4, slots.join(' | '))
check('注册的组件都是函数', components.length > 0 && components.every((c) => typeof c === 'function'))
check('注入过一份样式', cssTags.length === 1, 'tags=' + cssTags.length)

console.log('')
console.log(failed === 0 ? '全部通过' : failed + ' 项失败')
process.exit(failed === 0 ? 0 : 1)
