/**
 * dsh-worklog —— 浏览器端。
 *
 * 走 DSH 的官方客户端插件约定：宿主用 window.__ModuleLoader__.load({ id, factory })
 * 加载本文件，工厂返回 { name, inject, apply }，apply 里往 UI 槽位注册组件。
 *
 * 只依赖 react（宿主提供）。面板本身是纯 DOM，不用 JSX、不需要构建步骤：
 *   · sidebar.right.pane.tab / .title —— 右侧栏的一个标签页（主入口）
 *   · conversation.session.header.utilities —— 会话头部的按钮，兜底打开浮层
 */
window.__ModuleLoader__.load({
  id: 'dsh-worklog',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const KEY = 'dsh-worklog'
    const API = '/dsh-worklog'
    const STATUSES = ['todo', 'doing', 'done', 'blocked']
    const STATUS_META = {
      todo: { label: '待开始', color: '#8b93a7' },
      doing: { label: '进行中', color: '#e8a33d' },
      done: { label: '已完成', color: '#35b877' },
      blocked: { label: '已阻塞', color: '#e5645c' },
    }
    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
    const PRIORITIES = ['high', 'normal', 'low']
    const PRIORITY_META = {
      high: { label: '高', short: '高', color: '#e5645c' },
      normal: { label: '中', short: '中', color: '#8b93a7' },
      low: { label: '低', short: '低', color: '#a9b0bd' },
    }
    const NEW_PROJECT = '__new__'
    const DAY_MS = 86400000
    const CSS_ID = 'dsh-worklog-style'

    //#region 样式
    const CSS = `
.dshwl { font: inherit; color: inherit; --wl-line: rgba(127,127,127,.24); --wl-soft: rgba(127,127,127,.09); --wl-hover: rgba(127,127,127,.14); --wl-muted: rgba(127,127,127,.95); box-sizing: border-box; }
.dshwl *, .dshwl *::before, .dshwl *::after { box-sizing: border-box; }
.dshwl { padding: 12px 14px 18px; display: flex; flex-direction: column; gap: 10px; min-height: 100%; }
.wl-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.wl-headline { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; letter-spacing: .2px; }
.wl-logo { font-size: 14px; opacity: .75; }
.wl-stats { display: flex; gap: 12px; font-size: 11.5px; color: var(--wl-muted); }
.wl-stat b { font-size: 13px; font-weight: 600; margin-right: 3px; }
.wl-monthbar { display: flex; align-items: center; gap: 6px; }
.wl-nav, .wl-today, .wl-btn, .wl-icon, .wl-check, .wl-pill { font: inherit; border: none; background: none; color: inherit; cursor: pointer; }
.wl-nav { width: 24px; height: 24px; border-radius: 6px; font-size: 15px; line-height: 1; color: var(--wl-muted); }
.wl-nav:hover, .wl-icon:hover { background: var(--wl-hover); }
.wl-month { font-size: 13px; font-weight: 600; min-width: 96px; text-align: center; font-variant-numeric: tabular-nums; }
.wl-today { margin-left: auto; font-size: 11.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--wl-line); color: var(--wl-muted); }
.wl-today:hover { background: var(--wl-hover); }
.wl-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; display: inline-block; }
.wl-meta { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.wl-proj { flex: none; font-size: 10px; line-height: 14px; padding: 0 5px; border-radius: 4px; background: var(--wl-soft); color: var(--wl-muted); display: inline-flex; align-items: center; gap: 4px; max-width: 132px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wl-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; font-size: 10.5px; color: var(--wl-muted); text-align: center; }
.wl-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.wl-cell { position: relative; min-height: 40px; border-radius: 6px; border: 1px solid transparent; padding: 3px 5px 4px; display: flex; flex-direction: column; gap: 2px; background: transparent; cursor: pointer; transition: background .12s, border-color .12s; }
.wl-cell:hover { background: var(--wl-hover); }
.wl-cell.is-out { opacity: .3; }
.wl-cell.is-sel { border-color: rgba(77,107,254,.55); background: rgba(77,107,254,.06); }
.wl-cell.is-today { background: rgba(77,107,254,.08); }
.wl-cell.is-today.is-sel { background: rgba(77,107,254,.14); }
.wl-cell.is-today .wl-daynum { font-weight: 700; color: #4d6bfe; }
.wl-daynum { font-size: 11.5px; line-height: 1.2; font-variant-numeric: tabular-nums; opacity: .9; }
.wl-badges { display: flex; flex-wrap: wrap; gap: 2px; margin-top: auto; }
.wl-b { font-size: 9.5px; line-height: 12px; padding: 0 4px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.wl-b.s-done { background: rgba(53,184,119,.2); color: #35b877; font-weight: 600; }
.wl-b.s-doing { background: rgba(232,163,61,.22); color: #c98421; font-weight: 600; }
.wl-b.s-blocked { background: rgba(229,100,92,.2); color: #e5645c; font-weight: 600; }
.wl-b.s-todo { background: rgba(127,127,127,.16); color: var(--wl-muted); }
.wl-day { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
.wl-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.wl-toolbar-gap { flex: 1 1 auto; }
.wl-tabs { display: inline-flex; align-items: center; gap: 14px; flex: none; }
.wl-tab { flex: none; height: 22px; display: inline-flex; align-items: center; white-space: nowrap; font: inherit; font-size: 12px; padding: 0; border: none !important; border-bottom: 2px solid transparent !important; border-radius: 0 !important; background: none !important; box-shadow: none !important; color: var(--wl-muted); cursor: pointer; }
.wl-tab:hover { color: inherit; }
.wl-tab.is-on { color: #4d6bfe; border-bottom-color: rgba(77,107,254,.7) !important; font-weight: 600; }
.wl-tab b { font-weight: 600; opacity: .7; font-variant-numeric: tabular-nums; margin-left: 4px; }
.wl-projfilter {
  -webkit-appearance: none !important;
  appearance: none !important;
  flex: none;
  width: 124px !important;
  height: 22px !important;
  box-sizing: border-box;
  font: inherit;
  font-size: 11.5px;
  padding: 0 16px 0 0 !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background-color: transparent !important;
  color: var(--wl-muted) !important;
  cursor: pointer;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238b93a7' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 2px center;
}
.wl-projfilter.is-on { color: #4d6bfe !important; font-weight: 600; }
.wl-projfilter:focus { outline: none; }
.wl-mini.is-on { border-color: rgba(77,107,254,.5); background: rgba(77,107,254,.12); color: #4d6bfe; }
.wl-listhead { font-size: 10.5px; color: var(--wl-muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wl-daychip { font: inherit; font-size: 10px; line-height: 15px; padding: 0 5px; border-radius: 4px; border: none !important; background: rgba(77,107,254,.12) !important; color: #4d6bfe !important; cursor: pointer; }
.wl-daychip:hover { background: rgba(77,107,254,.2) !important; }
.wl-datechip { flex: 0 0 auto; white-space: nowrap; font: inherit; font-size: 10px; line-height: 15px; padding: 0 5px; border-radius: 4px; background: var(--wl-soft); color: var(--wl-muted); font-variant-numeric: tabular-nums; letter-spacing: .2px; }
.wl-pri { flex: none; font: inherit; font-size: 10px; line-height: 14px; padding: 0 5px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--wl-muted); cursor: pointer; }
.wl-pri:hover { background: var(--wl-hover); }
.wl-pri.p-high { background: rgba(229,100,92,.16); border-color: rgba(229,100,92,.4); color: #e5645c; font-weight: 700; }
.wl-pri.p-normal { opacity: .7; }
.wl-pri.p-low { opacity: .45; }
/* 优先级分段控件：三格一体，比下拉直观 */
.wl-seg { display: inline-flex; flex: none; height: 30px; box-sizing: border-box; border: 1px solid var(--wl-line); border-radius: 7px; overflow: hidden; }
.wl-segbtn { font: inherit; font-size: 11.5px; line-height: 1; padding: 0 11px; border: none !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; color: var(--wl-muted); cursor: pointer; }
.wl-segbtn + .wl-segbtn { border-left: 1px solid var(--wl-line) !important; }
.wl-segbtn:hover { background: var(--wl-hover) !important; }
.wl-segbtn.is-on { font-weight: 700; }
.wl-segbtn.is-on[data-value="high"] { background: rgba(229,100,92,.16) !important; color: #e5645c !important; }
.wl-segbtn.is-on[data-value="normal"] { background: rgba(127,127,127,.14) !important; color: inherit !important; }
.wl-segbtn.is-on[data-value="low"] { background: rgba(127,127,127,.09) !important; color: var(--wl-muted) !important; }
.wl-datechip.is-overdue { background: rgba(229,100,92,.14); color: #e5645c; font-weight: 600; }
.wl-add { display: flex; flex-direction: column; gap: 6px; }
.wl-add input[name="title"] { width: 100%; height: 30px; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 0 9px; border-radius: 7px; border: 1px solid var(--wl-line); background: transparent; color: inherit; }
.wl-add input[name="title"]:focus { outline: none; border-color: rgba(77,107,254,.55); }
.wl-add-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.wl-add-row .wl-btn { margin-left: auto; }
.wl-add .wl-projpick { flex: none; }
.wl-add .wl-btn { flex: none; }
.wl-projpick { display: inline-flex; align-items: center; gap: 4px; }
/* 原生 select 在宿主里可能被全局样式压成「黑框白底」，这里把 UA 外观彻底关掉，自己画 */
.wl-projpick select, .wl-projpick input {
  -webkit-appearance: none !important;
  appearance: none !important;
  width: 104px !important;
  height: 30px !important;
  box-sizing: border-box;
  font: inherit;
  font-size: 11.5px;
  padding: 0 20px 0 9px !important;
  border: 1px solid rgba(127,127,127,.32) !important;
  border-radius: 7px !important;
  background-color: rgba(127,127,127,.08) !important;
  color: inherit !important;
  cursor: pointer;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238b93a7' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}
.wl-projpick input { background-image: none !important; padding-right: 9px !important; cursor: text; }
.wl-projpick select:focus, .wl-projpick input:focus { outline: none; border-color: rgba(77,107,254,.55) !important; }
.wl-btn { height: 30px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--wl-line); color: inherit; }
.wl-btn:hover { background: var(--wl-hover); }
.wl-btn-primary { background: rgba(77,107,254,.14); border-color: rgba(77,107,254,.45); color: #4d6bfe; font-weight: 600; }
.wl-rows { display: flex; flex-direction: column; gap: 5px; }
.wl-row { display: flex; align-items: flex-start; gap: 7px; padding: 7px 8px; border-radius: 8px; background: var(--wl-soft); }
.wl-row.is-done .wl-title { text-decoration: line-through; opacity: .55; }
.wl-check { flex: none; width: 17px; height: 17px; margin-top: 1px; border-radius: 50%; border: 1.5px solid var(--wl-line); font-size: 10px; line-height: 1; color: transparent; display: flex; align-items: center; justify-content: center; }
.wl-check:hover { border-color: rgba(53,184,119,.7); }
.wl-check.is-on { background: rgba(53,184,119,.22); border-color: rgba(53,184,119,.75); color: #35b877; }
.wl-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wl-title { font-size: 12.5px; line-height: 1.35; word-break: break-word; }
.wl-note { font-size: 10.5px; line-height: 15px; color: var(--wl-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.wl-pill { flex: none; font-size: 10.5px; line-height: 16px; padding: 0 7px; border-radius: 999px; margin-top: 1px; }
.wl-pill.s-todo { background: rgba(127,127,127,.16); color: var(--wl-muted); }
.wl-pill.s-doing { background: rgba(232,163,61,.2); color: #c98421; }
.wl-pill.s-done { background: rgba(53,184,119,.2); color: #2f9e66; }
.wl-pill.s-blocked { background: rgba(229,100,92,.2); color: #e5645c; }
.wl-icon { flex: none; width: 20px; height: 20px; border-radius: 5px; font-size: 11.5px; line-height: 1; color: var(--wl-muted); }
.wl-icon.wl-danger:hover { background: rgba(229,100,92,.2); color: #e5645c; }
.wl-empty { font-size: 11.5px; color: var(--wl-muted); padding: 8px 2px; }
.wl-edit { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.wl-edit-row { display: flex; align-items: center; gap: 6px; }
.wl-edit input, .wl-edit select { height: 30px; box-sizing: border-box; font: inherit; font-size: 12px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--wl-line); background: transparent; color: inherit; min-width: 0; }
.wl-edit input[name="title"] { flex: 1; }
.wl-edit input[name="note"] { flex: 1; }
.wl-edit input:focus, .wl-edit select:focus { outline: none; border-color: rgba(77,107,254,.55); }
.wl-err { font-size: 11.5px; color: #e5645c; }
.wl-notice { font-size: 11.5px; color: #2f9e66; }
.wl-manage { display: flex; flex-direction: column; gap: 5px; padding: 7px 8px; border-radius: 8px; background: var(--wl-soft); }
.wl-manage-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; margin: 0; }
.wl-manage-row input { flex: 1; min-width: 0; font: inherit; font-size: 11.5px; padding: 3px 7px; border-radius: 5px; border: 1px solid var(--wl-line); background: transparent; color: inherit; }
.wl-manage-row input:focus { outline: none; border-color: rgba(77,107,254,.55); }
.wl-manage-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-manage-count { flex: none; color: var(--wl-muted); font-variant-numeric: tabular-nums; }
.wl-manage-hint { font-size: 10.5px; color: var(--wl-muted); opacity: .8; line-height: 1.4; }
.wl-mini { flex: none; font: inherit; font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 5px; border: 1px solid var(--wl-line); background: transparent; color: var(--wl-muted); cursor: pointer; }
.wl-mini:hover { background: var(--wl-hover); color: inherit; }
.wl-mini.wl-danger:hover { background: rgba(229,100,92,.18); color: #e5645c; border-color: rgba(229,100,92,.5); }
.wl-foot { font-size: 10.5px; color: var(--wl-muted); opacity: .7; word-break: break-all; }
.wl-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.28); display: flex; align-items: stretch; justify-content: flex-end; }
.wl-overlay-card { width: min(460px, 94vw); height: 100%; overflow: auto; border-left: 1px solid var(--wl-line); background: Canvas; box-shadow: -18px 0 48px rgba(0,0,0,.22); animation: wl-slide .16s ease-out; }
@supports not (background: Canvas) { .wl-overlay-card { background: #fff; } }
@keyframes wl-slide { from { transform: translateX(18px); opacity: .4; } to { transform: none; opacity: 1; } }
.wl-hbtn { font: inherit; font-size: 12px; line-height: 1; padding: 5px 8px; border-radius: 7px; border: 1px solid rgba(127,127,127,.28); background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.wl-hbtn:hover { background: rgba(127,127,127,.14); }
`
    //#endregion

    //#region 小工具
    /**
     * 样式只注入一次，但**必须跟得上版本**：
     * 宿主重挂插件（切会话、插件热重载）不会重载页面，旧的 <style> 还留在 head 里，
     * 以前这里「有 id 就 return」，结果新 DOM + 旧 CSS —— 新控件就退化成系统默认样式。
     */
    function injectCss() {
      try {
        const existing = document.getElementById(CSS_ID)
        if (existing) {
          if (existing.textContent !== CSS) existing.textContent = CSS
          return
        }
        const tag = document.createElement('style')
        tag.id = CSS_ID
        tag.textContent = CSS
        document.head.appendChild(tag)
      } catch (err) {}
    }

    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ))
    }

    function pad(n) {
      return String(n).padStart(2, '0')
    }

    function ymd(date) {
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    }

    function todayStr() {
      return ymd(new Date())
    }

    function shiftDays(date, delta) {
      return new Date(date.getTime() + delta * DAY_MS)
    }

    /** 6×7 网格，周一开头。 */
    function monthCells(month) {
      const first = new Date(month.getFullYear(), month.getMonth(), 1)
      const offset = (first.getDay() + 6) % 7
      const cells = []
      for (let i = 0; i < 42; i++) {
        cells.push(new Date(first.getFullYear(), first.getMonth(), 1 - offset + i))
      }
      return cells
    }

    function countsByDate(tasks) {
      const map = new Map()
      for (const task of tasks) {
        if (!task || !task.date) continue
        let bucket = map.get(task.date)
        if (!bucket) {
          bucket = { todo: 0, doing: 0, done: 0, blocked: 0, total: 0 }
          map.set(task.date, bucket)
        }
        bucket[task.status] = (bucket[task.status] || 0) + 1
        bucket.total += 1
      }
      return map
    }

    /** 项目名 → 稳定的色相，不存配置也能一眼区分。 */
    function projectColor(name) {
      const text = String(name || '')
      let hash = 0
      for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 360
      return 'hsl(' + hash + ' 56% 46%)'
    }

    /** 旧数据没有 priority 字段，一律按「中」处理。 */
    function normalizePriority(value) {
      const s = String(value == null ? '' : value).trim().toLowerCase()
      return PRIORITIES.indexOf(s) >= 0 ? s : 'normal'
    }

    /** 出现过的项目：[名字, 任务数]，按任务数从多到少。 */
    function projectsOf(tasks) {
      const map = new Map()
      for (const task of tasks) {
        const name = task && task.project ? String(task.project) : ''
        if (!name) continue
        map.set(name, (map.get(name) || 0) + 1)
      }
      return Array.from(map.entries()).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    }

    /**
     * 连续完成天数：从「最近一个有完成记录的日期」往回数，而不是死盯今天。
     * 否则补录历史（比如导入上个月的回顾）时会显示 0，看着像坏了。
     */
    function streakDays(tasks) {
      const doneDays = new Set()
      for (const task of tasks) {
        if (task && task.status === 'done' && task.date) doneDays.add(task.date)
      }
      if (doneDays.size === 0) return 0

      const today = todayStr()
      let latest = ''
      for (const day of doneDays) {
        if (day <= today && day > latest) latest = day
      }
      if (!latest) return 0

      let cursor = new Date(latest + 'T00:00:00')
      let streak = 0
      while (doneDays.has(ymd(cursor)) && streak < 3650) {
        streak += 1
        cursor = shiftDays(cursor, -1)
      }
      return streak
    }

    async function api(path, body) {
      const init = body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
      const res = await fetch(API + path, init)
      let data = {}
      try {
        data = await res.json()
      } catch (err) {}
      if (!res.ok || data.ok === false) throw new Error(data.error || ('请求失败 HTTP ' + res.status))
      return data
    }
    //#endregion

    //#region 面板（纯 DOM）
    function mountWorklog(container, options) {
      const opts = options || {}
      const state = {
        tasks: [],
        month: new Date(),
        view: 'open',
        day: '',
        filter: '',
        manage: false,
        projEdit: '',
        projConfirm: '',
        editing: '',
        confirming: '',
        loading: true,
        error: '',
        notice: '',
        file: '',
      }

      const root = document.createElement('div')
      root.className = 'dshwl'
      container.appendChild(root)

      let timer = 0
      let disposed = false

      function flash(message) {
        state.error = String(message || '')
        state.notice = ''
        render()
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (disposed) return
          state.error = ''
          render()
        }, 4000)
      }

      /** 成功提示：跟报错分开配色，别把「已改名」也画成红色。 */
      function toast(message) {
        state.notice = String(message || '')
        state.error = ''
        render()
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (disposed) return
          state.notice = ''
          render()
        }, 4000)
      }

      function upsert(task) {
        const index = state.tasks.findIndex((t) => t.id === task.id)
        if (index >= 0) state.tasks[index] = task
        else state.tasks.push(task)
      }

      async function load() {
        state.loading = true
        render()
        try {
          const data = await api('/state')
          state.tasks = Array.isArray(data.tasks) ? data.tasks : []
          state.file = data.file || ''
          state.error = ''
        } catch (err) {
          state.error = '读取失败：' + String(err.message || err)
        } finally {
          state.loading = false
          if (!disposed) render()
        }
      }

      async function save(patch) {
        try {
          const data = await api('/task', patch)
          upsert(data.task)
          state.editing = ''
          state.error = ''
          render()
        } catch (err) {
          flash(String(err.message || err))
        }
      }

      async function remove(id) {
        try {
          await api('/task/delete', { id })
          state.tasks = state.tasks.filter((t) => t.id !== id)
          state.confirming = ''
          render()
        } catch (err) {
          flash(String(err.message || err))
        }
      }

      async function renameProject(from, to) {
        try {
          const data = await api('/project/rename', { from, to })
          if (state.filter === from) state.filter = to
          state.projEdit = ''
          state.projConfirm = ''
          await load()
          toast('已改名：' + from + ' → ' + to + '（' + data.moved + ' 条任务）')
        } catch (err) {
          flash(String(err.message || err))
        }
      }

      async function dropProject(name) {
        try {
          const data = await api('/project/delete', { name })
          if (state.filter === name) state.filter = ''
          state.projConfirm = ''
          state.projEdit = ''
          await load()
          toast('已删除项目「' + name + '」，' + data.moved + ' 条任务退回未归类')
        } catch (err) {
          flash(String(err.message || err))
        }
      }

      /** 只按项目筛过的任务（顶部统计用它，不受「点了某一天」影响）。 */
      function projectTasks() {
        return state.filter
          ? state.tasks.filter((t) => t.project === state.filter)
          : state.tasks
      }

      /** 列表/工具栏用的任务：项目筛选 + 可选的某一天。 */
      function visibleTasks() {
        const base = projectTasks()
        return state.day ? base.filter((t) => t.date === state.day) : base
      }

      /**
       * 项目选择器：一个下拉（未归类 / 已有项目 / ＋新建项目…）。
       * 选「＋新建项目…」时把下拉换成输入框 —— 只改 DOM，不重绘，
       * 这样已经敲了一半的任务标题不会丢。
       */
      function renderProjectPicker(current) {
        const value = String(current || '')
        const names = projectsOf(state.tasks).map(([name]) => name)
        const options = ['<option value="">未归类</option>']
        for (const name of names) {
          options.push('<option value="' + esc(name) + '"' + (name === value ? ' selected' : '') + '>' + esc(name) + '</option>')
        }
        if (value && names.indexOf(value) < 0) {
          options.push('<option value="' + esc(value) + '" selected>' + esc(value) + '</option>')
        }
        options.push('<option value="' + NEW_PROJECT + '">＋ 新建项目…</option>')
        return '<span class="wl-projpick">'
          + '<select name="project" title="项目">' + options.join('') + '</select>'
          + '<input name="newproject" maxlength="40" placeholder="新项目名" autocomplete="off" hidden />'
          + '</span>'
      }

      /** 优先级：三格分段控件（高 / 中 / 低），比下拉更直观，也少一次点击。 */
      function renderPrioritySeg(current) {
        const value = normalizePriority(current)
        const buttons = PRIORITIES.map((p) => (
          '<button type="button" class="wl-segbtn' + (p === value ? ' is-on' : '') + '"'
          + ' data-act="priority-pick" data-value="' + p + '" title="优先级：' + PRIORITY_META[p].label + '">'
          + PRIORITY_META[p].label + '</button>'
        )).join('')
        return '<span class="wl-seg" role="group" aria-label="优先级">' + buttons + '</span>'
      }

      /** 从分段控件里读出选中的优先级（默认中）。 */
      function readPriorityPick(form) {
        const on = form.querySelector('.wl-seg .wl-segbtn.is-on')
        return normalizePriority(on ? on.getAttribute('data-value') : 'normal')
      }

      /** 从项目选择器里读出最终项目名（新建输入框优先）。 */
      function readProjectPick(form) {
        const wrap = form.querySelector('.wl-projpick')
        if (!wrap) return ''
        const typed = wrap.querySelector('input[name="newproject"]')
        const name = typed ? String(typed.value || '').trim() : ''
        if (typed && !typed.hidden && name) return name
        const select = wrap.querySelector('select[name="project"]')
        const value = select ? String(select.value || '') : ''
        return value === NEW_PROJECT ? '' : value
      }

      /**
       * 一条工具栏：左边「未完成 / 全部」，右边按项目筛选。
       * 管理项目收进下拉里的最后一项，省掉一个按钮。
       */
      function renderToolbar() {
        const all = visibleTasks()
        const open = all.filter((task) => task.status !== 'done')
        const projects = projectsOf(state.tasks)

        const tabs = '<div class="wl-tabs">'
          + '<button class="wl-tab' + (state.view === 'open' ? ' is-on' : '') + '" data-act="view" data-view="open">未完成<b>' + open.length + '</b></button>'
          + '<button class="wl-tab' + (state.view === 'all' ? ' is-on' : '') + '" data-act="view" data-view="all">全部<b>' + all.length + '</b></button>'
          + '</div>'

        // 点选某一天时，把日期显示成一个贴在标签旁边的可清除条件，
        // 这样「未完成 0 / 全部 0」就有了解释，不至于像是数据丢了
        const dayChip = state.day
          ? '<button class="wl-daychip" data-act="clear-day" title="取消日期筛选">' + esc(state.day.slice(5)) + ' ×</button>'
          : ''

        const options = ['<option value=""' + (state.filter ? '' : ' selected') + '>全部项目</option>']
        for (const [name, count] of projects) {
          options.push('<option value="' + esc(name) + '"' + (state.filter === name ? ' selected' : '') + '>'
            + esc(name) + '（' + count + '）</option>')
        }
        options.push('<option value="__manage__">管理项目…</option>')

        const filter = '<select class="wl-projfilter' + (state.filter ? ' is-on' : '') + '" title="按项目筛选">'
          + options.join('') + '</select>'

        return '<div class="wl-toolbar">' + tabs + dayChip + '<span class="wl-toolbar-gap"></span>' + filter + '</div>'
      }

      function renderManage() {
        if (!state.manage) return ''
        const projects = projectsOf(state.tasks)
        if (projects.length === 0) return '<div class="wl-manage"><div class="wl-empty">还没有项目。在任务里填一个项目名，它就会出现在这里。</div></div>'

        const rows = projects.map(([name, count]) => {
          if (state.projEdit === name) {
            return '<form class="wl-manage-row" data-act="proj-rename-save" data-from="' + esc(name) + '">'
              + '<i class="wl-dot" style="background:' + projectColor(name) + '"></i>'
              + '<input name="to" value="' + esc(name) + '" maxlength="40" autocomplete="off" />'
              + '<button class="wl-mini" type="submit">保存</button>'
              + '<button class="wl-mini" type="button" data-act="proj-cancel">取消</button>'
              + '</form>'
          }
          return '<div class="wl-manage-row">'
            + '<i class="wl-dot" style="background:' + projectColor(name) + '"></i>'
            + '<span class="wl-manage-name">' + esc(name) + '</span>'
            + '<span class="wl-manage-count">' + count + ' 条</span>'
            + '<button class="wl-mini" data-act="proj-edit" data-project="' + esc(name) + '">改名</button>'
            + '<button class="wl-mini wl-danger" data-act="proj-del" data-project="' + esc(name) + '">'
            + (state.projConfirm === name ? '确认?' : '删除')
            + '</button>'
            + '</div>'
        }).join('')

        return '<div class="wl-manage">' + rows
          + '<div class="wl-manage-hint">改名会一并改掉该项目的所有任务；改成已有项目名等于合并。删除只把任务退回「未归类」，不删任务。</div>'
          + '</div>'
      }

      /**
       * 日历只做概览：哪几天有活儿、完成多少。
       * 色标按「项目筛选」算，**不受点选某一天影响** —— 点一个空日期，
       * 别的日子的色标不该跟着消失（否则整个日历像被清空了）。
       */
      function renderCalendar() {
        const byDate = countsByDate(projectTasks())
        const today = todayStr()
        const cells = monthCells(state.month)
        const body = cells.map((date) => {
          const key = ymd(date)
          const bucket = byDate.get(key)
          const classes = ['wl-cell']
          if (date.getMonth() !== state.month.getMonth()) classes.push('is-out')
          if (key === today) classes.push('is-today')
          if (key === state.day) classes.push('is-sel')
          const badges = []
          if (bucket) {
            if (bucket.done) badges.push('<span class="wl-b s-done">' + bucket.done + '</span>')
            if (bucket.doing) badges.push('<span class="wl-b s-doing">' + bucket.doing + '</span>')
            if (bucket.blocked) badges.push('<span class="wl-b s-blocked">' + bucket.blocked + '</span>')
            const rest = bucket.todo
            if (rest && !bucket.done) badges.push('<span class="wl-b s-todo">' + rest + '</span>')
          }
          return '<div class="' + classes.join(' ') + '" data-act="day" data-date="' + key + '">'
            + '<div class="wl-daynum">' + date.getDate() + '</div>'
            + '<div class="wl-badges">' + badges.join('') + '</div>'
            + '</div>'
        }).join('')

        return '<div class="wl-week">' + WEEKDAYS.map((w) => '<div>' + w + '</div>').join('') + '</div>'
          + '<div class="wl-grid">' + body + '</div>'
      }

      function renderRow(task, opts) {
        const showDate = !!(opts && opts.showDate)
        const overdue = task.status !== 'done' && String(task.date) < todayStr()
        const currentPriority = normalizePriority(task.priority)
        const dateChip = showDate
          ? '<span class="wl-datechip' + (overdue ? ' is-overdue' : '') + '" title="' + esc(task.date) + '">' + esc(String(task.date).slice(5)) + '</span>'
          : ''

        if (state.editing === task.id) {
          const options = STATUSES.map((s) => (
            '<option value="' + s + '"' + (task.status === s ? ' selected' : '') + '>' + STATUS_META[s].label + '</option>'
          )).join('')
          return '<div class="wl-row" data-id="' + esc(task.id) + '">'
            + '<form class="wl-edit" data-act="edit-save" data-id="' + esc(task.id) + '">'
            + '<div class="wl-edit-row">'
            + dateChip
            + '<input name="title" value="' + esc(task.title) + '" maxlength="200" placeholder="任务标题" />'
            + '<button class="wl-btn wl-btn-primary" type="submit">保存</button>'
            + '<button class="wl-btn" type="button" data-act="edit-cancel">取消</button>'
            + '</div>'
            + '<div class="wl-edit-row">'
            + '<input type="date" name="date" value="' + esc(task.date) + '" />'
            + '<select name="status">' + options + '</select>'
            + renderProjectPicker(task.project || '')
            + '</div>'
            + '<div class="wl-edit-row">'
            + renderPrioritySeg(currentPriority)
            + '<input name="note" value="' + esc(task.note || '') + '" maxlength="4000" placeholder="备注（可留空）" />'
            + '</div>'
            + '</form>'
            + '</div>'
        }

        const meta = STATUS_META[task.status] || STATUS_META.todo
        const done = task.status === 'done'
        const priMeta = PRIORITY_META[currentPriority]
        // 标题独占一行（长标题不再被日期/状态挤成三行）；日期 · 优先级 · 状态 · 项目 · 备注 收到第二行
        const metaParts = [
          dateChip,
          '<button class="wl-pri p-' + currentPriority + '" data-act="priority" data-id="' + esc(task.id) + '" title="优先级：' + priMeta.label + '（点击切换）">' + priMeta.label + '</button>',
          '<button class="wl-pill s-' + esc(task.status) + '" data-act="cycle" data-id="' + esc(task.id) + '" title="切换状态（' + meta.label + '）">' + meta.label + '</button>',
        ]
        if (task.project) {
          metaParts.push('<span class="wl-proj"><i class="wl-dot" style="background:' + projectColor(task.project) + '"></i>' + esc(task.project) + '</span>')
        }
        if (task.note) metaParts.push('<span class="wl-note">' + esc(task.note) + '</span>')
        return '<div class="wl-row' + (done ? ' is-done' : '') + '" data-id="' + esc(task.id) + '">'
          + '<button class="wl-check' + (done ? ' is-on' : '') + '" data-act="toggle" data-id="' + esc(task.id) + '" title="' + (done ? '标记为待开始' : '标记完成') + '">✓</button>'
          + '<div class="wl-body">'
          + '<div class="wl-title">' + esc(task.title) + '</div>'
          + '<div class="wl-meta">' + metaParts.join('') + '</div>'
          + '</div>'
          + '<button class="wl-icon" data-act="edit" data-id="' + esc(task.id) + '" title="编辑">✎</button>'
          + '<button class="wl-icon wl-danger" data-act="del" data-id="' + esc(task.id) + '" title="删除">' + (state.confirming === task.id ? '确认?' : '×') + '</button>'
          + '</div>'
      }

      function renderList(tasks, emptyText) {
        if (!tasks.length) return '<div class="wl-empty">' + emptyText + '</div>'
        return '<div class="wl-rows">' + tasks.map((task) => renderRow(task, { showDate: true })).join('') + '</div>'
      }

      /** 未完成列表：优先级高的排在前面，同优先级按记录日期从早到晚。 */
      function byDateAsc(a, b) {
        const pa = PRIORITIES.indexOf(normalizePriority(a.priority))
        const pb = PRIORITIES.indexOf(normalizePriority(b.priority))
        if (pa !== pb) return pa - pb
        if (a.date !== b.date) return a.date < b.date ? -1 : 1
        return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
      }

      function byDateDesc(a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1
        return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)
      }

      function renderDayArea() {
        const all = visibleTasks()
        const open = all.filter((task) => task.status !== 'done')
        const scope = state.filter ? ' · ' + state.filter : ''

        const add = '<form class="wl-add" data-act="add">'
          + '<input name="title" maxlength="200" placeholder="记一条：今天做了什么" autocomplete="off" />'
          + '<div class="wl-add-row">'
          + renderPrioritySeg('normal')
          + renderProjectPicker(state.filter)
          + '<button class="wl-btn wl-btn-primary" type="submit">添加</button>'
          + '</div>'
          + '</form>'

        // 点了日历某一天时，把这一天显示成一个可清除的条件
        const emptyHint = state.day ? '这一天没有符合条件的任务。' : ''

        const body = state.view === 'all'
          ? '<div class="wl-listhead">全部 · ' + all.length + ' 条' + scope + (state.day ? '' : '（从新到旧）') + '</div>'
            + renderList(all.slice().sort(byDateDesc), emptyHint || '还没有记录。')
          : '<div class="wl-listhead">未完成 · ' + open.length + ' 条' + scope + (state.day ? '' : '（高优先级在前，同优先级按日期）') + '</div>'
            + renderList(open.slice().sort(byDateAsc), emptyHint || '没有未完成的任务。')

        return '<div class="wl-day">' + add + body + '</div>'
      }

      function render() {
        if (disposed) return
        const month = state.month
        const monthPrefix = month.getFullYear() + '-' + pad(month.getMonth() + 1)
        const visible = projectTasks() // 统计只跟项目筛选走，不跟「点了某一天」走
        let monthDone = 0
        let doing = 0
        for (const task of visible) {
          if (task.status === 'doing') doing += 1
          if (task.status === 'done' && String(task.date || '').indexOf(monthPrefix) === 0) monthDone += 1
        }
        const streak = streakDays(visible)

        const head = '<div class="wl-head">'
          + '<div class="wl-headline"><span class="wl-logo">◷</span><span>工作记录</span></div>'
          + '<div class="wl-stats">'
          + '<span class="wl-stat"><b>' + monthDone + '</b>本月完成</span>'
          + '<span class="wl-stat"><b>' + doing + '</b>进行中</span>'
          + '<span class="wl-stat"><b>' + streak + '</b>连续天数</span>'
          + '</div></div>'

        const bar = '<div class="wl-monthbar">'
          + '<button class="wl-nav" data-act="prev" title="上个月">‹</button>'
          + '<div class="wl-month">' + month.getFullYear() + ' 年 ' + (month.getMonth() + 1) + ' 月</div>'
          + '<button class="wl-nav" data-act="next" title="下个月">›</button>'
          + '<button class="wl-today" data-act="today">今天</button>'
          + '</div>'

        const errorLine = state.error ? '<div class="wl-err">' + esc(state.error) + '</div>' : ''
        const noticeLine = state.notice ? '<div class="wl-notice">' + esc(state.notice) + '</div>' : ''
        const loadingLine = state.loading && state.tasks.length === 0
          ? '<div class="wl-empty">正在读取…</div>'
          : renderCalendar() + renderDayArea()

        const foot = state.file && opts.showFile !== false
          ? '<div class="wl-foot">数据文件：' + esc(state.file) + '</div>'
          : ''

        root.innerHTML = head + bar + renderToolbar() + renderManage() + errorLine + noticeLine + loadingLine + foot
      }

      // —— 事件：全部走委托，重绘不会丢监听 ——
      root.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-act]') : null
        if (!target || !root.contains(target)) return
        const act = target.getAttribute('data-act')
        const id = target.getAttribute('data-id') || ''

        if (act === 'prev' || act === 'next') {
          const delta = act === 'prev' ? -1 : 1
          state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1)
          state.day = '' // 换月了，日期筛选不再对应日历上任何一格
          state.editing = ''
          state.confirming = ''
          render()
          return
        }
        if (act === 'today') {
          const now = new Date()
          state.month = new Date(now.getFullYear(), now.getMonth(), 1)
          state.day = ''
          render()
          return
        }
        if (act === 'day') {
          const day = target.getAttribute('data-date') || ''
          state.day = state.day === day ? '' : day // 再点一次取消
          state.editing = ''
          state.confirming = ''
          render()
          return
        }
        if (act === 'clear-day') {
          state.day = ''
          render()
          return
        }
        if (act === 'view') {
          state.view = target.getAttribute('data-view') === 'all' ? 'all' : 'open'
          state.editing = ''
          state.confirming = ''
          render()
          return
        }
        if (act === 'filter') {
          state.filter = target.getAttribute('data-project') || ''
          state.editing = ''
          state.confirming = ''
          render()
          return
        }
        if (act === 'manage-toggle') {
          state.manage = !state.manage
          state.projEdit = ''
          state.projConfirm = ''
          render()
          return
        }
        if (act === 'proj-edit') {
          state.projEdit = target.getAttribute('data-project') || ''
          state.projConfirm = ''
          render()
          return
        }
        if (act === 'proj-cancel') {
          state.projEdit = ''
          render()
          return
        }
        if (act === 'proj-del') {
          const name = target.getAttribute('data-project') || ''
          if (state.projConfirm === name) dropProject(name)
          else {
            state.projConfirm = name
            state.projEdit = ''
            render()
          }
          return
        }
        if (act === 'toggle') {
          const task = state.tasks.find((t) => t.id === id)
          if (task) save({ id, status: task.status === 'done' ? 'todo' : 'done' })
          return
        }
        if (act === 'cycle') {
          const task = state.tasks.find((t) => t.id === id)
          if (task) {
            const next = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]
            save({ id, status: next })
          }
          return
        }
        if (act === 'priority') {
          const task = state.tasks.find((t) => t.id === id)
          if (task) {
            const current = normalizePriority(task.priority)
            const next = PRIORITIES[(PRIORITIES.indexOf(current) + 1) % PRIORITIES.length]
            save({ id, priority: next })
          }
          return
        }
        // 表单里的优先级分段控件：只切 class，不重绘（保住已输入的标题）
        if (act === 'priority-pick') {
          const seg = target.closest('.wl-seg')
          if (seg) {
            for (const btn of seg.querySelectorAll('.wl-segbtn')) btn.classList.remove('is-on')
            target.classList.add('is-on')
          }
          return
        }
        if (act === 'edit') {
          state.editing = state.editing === id ? '' : id
          state.confirming = ''
          render()
          return
        }
        if (act === 'edit-cancel') {
          state.editing = ''
          render()
          return
        }
        if (act === 'del') {
          if (state.confirming === id) remove(id)
          else {
            state.confirming = id
            render()
          }
        }
      })

      // 选了「＋ 新建项目…」就把下拉换成输入框（不重绘，保住已输入的标题）
      root.addEventListener('change', (event) => {
        const el = event.target
        if (!(el instanceof Element) || el.tagName !== 'SELECT') return

        // 工具栏上的项目筛选（最后一项是「管理项目…」）
        if (el.classList.contains('wl-projfilter')) {
          if (el.value === '__manage__') {
            state.manage = !state.manage
            state.projEdit = ''
            state.projConfirm = ''
            render()
            return
          }
          state.filter = String(el.value || '')
          state.editing = ''
          state.confirming = ''
          render()
          return
        }

        // 任务表单里的项目选择器：「＋ 新建项目…」→ 换成输入框
        if (el.name !== 'project') return
        const wrap = el.closest('.wl-projpick')
        if (!wrap) return
        const typed = wrap.querySelector('input[name="newproject"]')
        if (!typed) return
        if (el.value === NEW_PROJECT) {
          el.hidden = true
          typed.hidden = false
          typed.value = ''
          typed.focus()
        }
      })

      // 新建输入框留空失焦 → 退回下拉，别把人困在输入态里
      root.addEventListener('focusout', (event) => {
        const el = event.target
        if (!(el instanceof Element) || el.name !== 'newproject') return
        if (String(el.value || '').trim()) return
        const wrap = el.closest('.wl-projpick')
        if (!wrap) return
        el.hidden = true
        const select = wrap.querySelector('select[name="project"]')
        if (select) {
          select.hidden = false
          select.value = ''
        }
      })

      root.addEventListener('submit', (event) => {
        const form = event.target instanceof Element ? event.target.closest('[data-act]') : null
        if (!form) return
        event.preventDefault()
        const act = form.getAttribute('data-act')

        if (act === 'add') {
          const input = form.querySelector('input[name="title"]')
          const title = input ? String(input.value || '').trim() : ''
          if (!title) return
          const project = readProjectPick(form)
          const priority = readPriorityPick(form)
          Promise.resolve(save({ title, date: todayStr(), status: 'todo', priority, project })).then(() => {
            // 连续记录时不用再点一次输入框
            const next = root.querySelector('.wl-add input[name="title"]')
            if (next) next.focus()
          })
          return
        }

        if (act === 'proj-rename-save') {
          const from = form.getAttribute('data-from') || ''
          const input = form.querySelector('input[name="to"]')
          const to = input ? String(input.value || '').trim() : ''
          if (!to) {
            flash('项目名不能为空')
            return
          }
          renameProject(from, to)
          return
        }

        if (act === 'edit-save') {
          const id = form.getAttribute('data-id') || ''
          const title = String(form.querySelector('input[name="title"]').value || '').trim()
          if (!title) {
            flash('任务标题不能为空')
            return
          }
          save({
            id,
            title,
            note: String(form.querySelector('input[name="note"]').value || ''),
            project: readProjectPick(form),
            date: String(form.querySelector('input[name="date"]').value || todayStr()),
            status: String(form.querySelector('select[name="status"]').value || 'todo'),
            priority: readPriorityPick(form),
          })
        }
      })

      render()
      load()

      return function dispose() {
        disposed = true
        clearTimeout(timer)
        try { root.remove() } catch (err) {}
      }
    }
    //#endregion

    //#region React 薄壳（只负责把纯 DOM 面板挂到宿主的槽位上）
    function WorklogMount() {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const host = ref.current
        if (!host) return undefined
        return mountWorklog(host, {})
      }, [])
      return React.createElement('div', {
        ref,
        style: { width: '100%', height: '100%', overflow: 'auto' },
      })
    }

    function WorklogPane() {
      return React.createElement(WorklogMount, null)
    }

    function WorklogTabTitle() {
      return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, '◷ 工作记录')
    }

    function WorklogOverlay(props) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])
      return React.createElement('div', {
        className: 'wl-overlay',
        onClick: (event) => {
          if (event.target === event.currentTarget) props.onClose()
        },
      }, React.createElement('div', { className: 'wl-overlay-card' }, React.createElement(WorklogMount, null)))
    }

    function WorklogHeaderButton() {
      const [open, setOpen] = React.useState(false)
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', {
          type: 'button',
          className: 'wl-hbtn',
          title: '工作记录（日历 / 状态回溯）',
          onClick: () => setOpen((value) => !value),
        }, '◷ 记录'),
        open ? React.createElement(WorklogOverlay, { onClose: () => setOpen(false) }) : null,
      )
    }
    //#endregion

    //#region 插件入口
    function apply(ctx) {
      injectCss()
      const disposers = []
      const release = () => {
        for (const dispose of disposers.splice(0)) {
          try { dispose() } catch (err) {}
        }
      }

      try { ctx.effect(() => release) } catch (err) {}

      const register = (fn) => {
        try {
          const dispose = fn()
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch (err) {
          console.warn('[dsh-worklog] 槽位注册失败：' + String((err && err.message) || err))
        }
      }

      // 主入口：右侧栏里的一个标签页
      register(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: KEY,
        inject: () => ({}),
      }, WorklogPane)))

      register(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: KEY,
        inject: () => ({}),
      }, WorklogTabTitle)))

      // 兜底入口一：会话头部的按钮，点开是右侧抽屉
      register(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: KEY + ':header',
        order: 20,
        registrant: KEY,
      }, WorklogHeaderButton)))

      // 兜底入口二：设置里的一整页（任何界面都能进）
      register(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: KEY,
        order: 80,
        label: () => '工作记录',
        inject: () => ({}),
      }, WorklogPane)))
    }

    exports.name = KEY
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
