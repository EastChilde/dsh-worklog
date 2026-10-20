/**
 * dsh-worklog —— 服务端业务逻辑（可热重载的那一层）。
 *
 * 单独放在这里，是为了让 lib/index.js 能在不重启宿主的前提下重新 import 本文件：
 * POST /dsh-worklog/reload → index.js 用 ?t=时间戳 重新加载 core.js → 新逻辑立即生效。
 * 这样改数据模型 / 统计口径不用重启整个 DSH（改客户端 UI 仍然刷新页面即可）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.join(DSH_HOME, 'dsh-worklog')
export const DATA_FILE = path.join(DATA_DIR, 'tasks.json')
const MAX_BODY = 256 * 1024
const STATUSES = ['todo', 'doing', 'done', 'blocked']
const PRIORITIES = ['low', 'normal', 'high']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function cleanDate(value, fallback) {
  const s = String(value == null ? '' : value)
  return DATE_RE.test(s) ? s : fallback
}

function cleanTitle(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 200)
}

function cleanNote(value) {
  return String(value == null ? '' : value).slice(0, 4000)
}

/** 项目名：单行、空白归一、最多 40 字；空串 = 未归类。 */
function cleanProject(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 40)
}

/** 优先级：low | normal | high，非法值退回 fallback（默认 normal）。 */
function cleanPriority(value, fallback) {
  const s = String(value == null ? '' : value).trim().toLowerCase()
  return PRIORITIES.indexOf(s) >= 0 ? s : fallback
}

function isTask(t) {
  return !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.title === 'string'
}

function emptyStore() {
  return { version: 1, tasks: [] }
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    const tasks = Array.isArray(parsed && parsed.tasks) ? parsed.tasks.filter(isTask) : []
    return { version: 1, tasks }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[dsh-worklog] 读取任务库失败，本次按空库处理：' + String((err && err.message) || err))
    }
    return emptyStore()
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${DATA_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE) // 原子替换：写一半断电也不会留下半个 JSON
}

/** 新建或局部更新一条任务；缺字段用旧值，状态切换时维护 doneAt。 */
function mergeTask(prev, patch) {
  const base = prev || {
    id: newId(),
    date: todayLocal(),
    title: '',
    status: 'todo',
    priority: 'normal',
    note: '',
    project: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    doneAt: null,
  }
  const next = Object.assign({}, base)

  if (patch.title !== undefined) next.title = cleanTitle(patch.title)
  if (patch.note !== undefined) next.note = cleanNote(patch.note)
  if (patch.project !== undefined) next.project = cleanProject(patch.project)
  if (patch.priority !== undefined) next.priority = cleanPriority(patch.priority, base.priority || 'normal')
  if (patch.date !== undefined) next.date = cleanDate(patch.date, base.date)
  if (patch.status !== undefined) next.status = STATUSES.indexOf(patch.status) >= 0 ? patch.status : base.status

  next.title = next.title || ''
  next.note = next.note || ''
  next.project = cleanProject(next.project)
  next.priority = cleanPriority(next.priority, 'normal')
  next.date = cleanDate(next.date, todayLocal())
  next.status = STATUSES.indexOf(next.status) >= 0 ? next.status : 'todo'
  next.updatedAt = nowIso()

  if (next.status === 'done') {
    if (!next.doneAt) next.doneAt = nowIso()
  } else {
    next.doneAt = null
  }
  return next
}

export function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

export async function handleState(req, res) {
  const store = readStore()
  sendJson(res, 200, { ok: true, tasks: store.tasks, today: todayLocal(), file: DATA_FILE })
}

/**
 * 写一条任务（新建或局部更新）并返回它。
 * HTTP 路由和 Agent 工具共用这一份逻辑 —— 两边行为不会跑偏。
 * @throws 标题为空等用户可见错误
 */
export function saveTask(patch) {
  const store = readStore()
  const id = typeof patch.id === 'string' ? patch.id : ''
  const index = id ? store.tasks.findIndex((t) => t.id === id) : -1
  const prev = index >= 0 ? store.tasks[index] : null

  if (id && !prev) throw new Error('找不到任务：' + id)
  if (!prev && !cleanTitle(patch.title)) throw new Error('任务标题不能为空')

  const task = mergeTask(prev, patch)
  if (!task.title) throw new Error('任务标题不能为空')

  if (index >= 0) store.tasks[index] = task
  else store.tasks.push(task)

  writeStore(store)
  return task
}

/**
 * 查任务。所有条件都可省略；按日期倒序、同一天按状态与创建时间。
 * limit 默认 100（避免把整库塞回模型上下文）。
 */
export function listTasks(query) {
  const q = query || {}
  const from = cleanDate(q.from, '')
  const to = cleanDate(q.to, '')
  const project = q.project === undefined ? '' : cleanProject(q.project)
  const status = STATUSES.indexOf(q.status) >= 0 ? q.status : ''
  const priority = PRIORITIES.indexOf(q.priority) >= 0 ? q.priority : ''
  const keyword = String(q.keyword == null ? '' : q.keyword).trim().toLowerCase()
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500)

  const all = readStore().tasks
  const matched = all.filter((task) => {
    if (from && task.date < from) return false
    if (to && task.date > to) return false
    if (q.project !== undefined && (task.project || '') !== project) return false
    if (status && task.status !== status) return false
    if (priority && (task.priority || 'normal') !== priority) return false
    if (keyword) {
      const hay = (task.title + ' ' + (task.note || '') + ' ' + (task.project || '')).toLowerCase()
      if (hay.indexOf(keyword) < 0) return false
    }
    return true
  })

  matched.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    const delta = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
    if (delta !== 0) return delta
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  })

  return { total: matched.length, tasks: matched.slice(0, limit) }
}

/** 项目汇总：[{ name, total, done, doing }]，按任务数倒序。 */
export function projectSummary() {
  const map = new Map()
  for (const task of readStore().tasks) {
    const name = task.project || ''
    if (!name) continue
    let bucket = map.get(name)
    if (!bucket) {
      bucket = { name, total: 0, done: 0, doing: 0 }
      map.set(name, bucket)
    }
    bucket.total += 1
    if (task.status === 'done') bucket.done += 1
    if (task.status === 'doing') bucket.doing += 1
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** 改项目名：把所有任务从 from 挪到 to（to 已存在即等于「合并」）。 */
export function renameProject(from, to) {
  const source = cleanProject(from)
  const target = cleanProject(to)
  if (!source) throw new Error('缺少原项目名')
  if (!target) throw new Error('新项目名不能为空')
  if (source === target) return { moved: 0, from: source, to: target }

  const store = readStore()
  let moved = 0
  for (const task of store.tasks) {
    if ((task.project || '') === source) {
      task.project = target
      task.updatedAt = nowIso()
      moved += 1
    }
  }
  if (moved) writeStore(store)
  return { moved, from: source, to: target }
}

/** 删项目：把该项目的任务退回「未归类」（任务本身不删）。 */
export function deleteProject(name) {
  const target = cleanProject(name)
  if (!target) throw new Error('缺少项目名')
  const store = readStore()
  let moved = 0
  for (const task of store.tasks) {
    if ((task.project || '') === target) {
      task.project = ''
      task.updatedAt = nowIso()
      moved += 1
    }
  }
  if (moved) writeStore(store)
  return { moved, name: target }
}

export async function handleSave(req, res) {
  const body = await readJsonBody(req)
  const task = saveTask(body)
  sendJson(res, 200, { ok: true, task, file: DATA_FILE })
}

export async function handleProjectRename(req, res) {
  const body = await readJsonBody(req)
  const result = renameProject(body.from, body.to)
  sendJson(res, 200, Object.assign({ ok: true }, result))
}

export async function handleProjectDelete(req, res) {
  const body = await readJsonBody(req)
  const result = deleteProject(body.name)
  sendJson(res, 200, Object.assign({ ok: true }, result))
}

export async function handleDelete(req, res) {
  const body = await readJsonBody(req)
  const store = readStore()
  const before = store.tasks.length
  store.tasks = store.tasks.filter((t) => t.id !== body.id)
  if (store.tasks.length !== before) writeStore(store)
  sendJson(res, 200, { ok: true })
}
