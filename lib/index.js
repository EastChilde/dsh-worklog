/**
 * dsh-worklog —— 服务端入口。
 *
 * 只做三件事：
 *   1. 把 /dsh-worklog/* 注册到宿主的 webServer；
 *   2. 把请求转给 lib/core.js（业务逻辑与存储都在那里）；
 *   3. 提供 /dsh-worklog/reload：重新 import core.js，改完服务端代码不必重启宿主。
 *
 * 数据形状（一条任务）：
 *   { id, date: 'YYYY-MM-DD', title, status, note, project, createdAt, updatedAt, doneAt }
 *   status ∈ todo | doing | done | blocked；project 为自由文本（空串 = 未归类）
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as initialCore from './core.js'
import { registerWorklogTools } from './tools.js'

const CORE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'core.js')
const CORE_URL = pathToFileURL(CORE_FILE).href

// 当前生效的业务模块；reload 时整体替换，失败保持旧的。
let core = initialCore
let coreReloadedAt = null

async function reloadCore() {
  const next = await import(CORE_URL + '?t=' + Date.now())
  const required = ['handleState', 'handleSave', 'handleDelete', 'sendJson']
  for (const name of required) {
    if (typeof next[name] !== 'function') throw new Error('core.js 缺少导出：' + name)
  }
  core = next
  coreReloadedAt = new Date().toISOString()
  return coreReloadedAt
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const message = String((err && err.message) || err)
      try {
        initialCore.sendJson(res, 400, { ok: false, error: message })
      } catch (err2) {
        try { res.end() } catch (err3) {}
      }
    }
  }
}

async function handleReload(req, res) {
  try {
    const at = await reloadCore()
    initialCore.sendJson(res, 200, { ok: true, reloadedAt: at })
  } catch (err) {
    initialCore.sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
  }
}

export default {
  name: 'dsh-worklog',
  apply(root) {
    const disposers = []
    root.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch (err) {}
      }
    })

    root.inject(['webServer'], (ctx) => {
      const routes = [
        { path: '/dsh-worklog/state', handler: (req, res) => core.handleState(req, res) },
        { path: '/dsh-worklog/task', handler: (req, res) => core.handleSave(req, res) },
        { path: '/dsh-worklog/task/delete', handler: (req, res) => core.handleDelete(req, res) },
        { path: '/dsh-worklog/project/rename', handler: (req, res) => core.handleProjectRename(req, res) },
        { path: '/dsh-worklog/project/delete', handler: (req, res) => core.handleProjectDelete(req, res) },
        { path: '/dsh-worklog/reload', handler: handleReload },
      ]
      for (const item of routes) {
        try {
          disposers.push(ctx.webServer.register({
            kind: 'exact',
            path: item.path,
            handler: route(item.handler),
          }))
        } catch (err) {
          console.warn('[dsh-worklog] 注册路由失败 ' + item.path + '：' + String((err && err.message) || err))
        }
      }
      console.log('[dsh-worklog] 已就绪，数据文件：' + initialCore.DATA_FILE + '（POST /dsh-worklog/reload 可热重载服务端逻辑）')
    })

    // Agent 工具：单独等 tools 服务。它缺失时只有工具没有，路由不受影响。
    root.inject(['tools'], (tctx) => {
      registerWorklogTools(tctx, () => core).then((result) => {
        disposers.push(result.dispose)
        if (result.count > 0) {
          console.log('[dsh-worklog] 已注册 ' + result.count + ' 个 Agent 工具：worklog_add / worklog_update / worklog_list / worklog_projects')
        } else {
          console.warn('[dsh-worklog] 没有可用的 tools 服务，Agent 工具未注册（面板功能不受影响）')
        }
      }).catch((err) => {
        console.warn('[dsh-worklog] 注册 Agent 工具失败：' + String((err && err.message) || err))
      })
    })
  },
}
