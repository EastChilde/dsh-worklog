/**
 * dsh-worklog —— Agent 工具。
 *
 * 让模型能在对话里直接读写这份工作记录：
 *   worklog_add / worklog_list / worklog_update / worklog_projects
 *
 * 两个刻意的设计：
 *   1. @deepseek-ai/dsh-tools 用动态 import —— 解析不到就退回「裸定义」，
 *      绝不能让工具链的问题把整个插件（含 HTTP 路由）带崩。
 *   2. 业务逻辑一律走 getCore()，不静态 import core.js，
 *      这样 /dsh-worklog/reload 换掉 core 之后，工具也跟着用新逻辑。
 */

const STATUS_LABEL = { todo: '待开始', doing: '进行中', done: '已完成', blocked: '已阻塞' }
const PRIORITY_LABEL = { high: '高', normal: '中', low: '低' }

let cachedDefineTool = null

async function loadDefineTool() {
  if (cachedDefineTool) return cachedDefineTool
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod && typeof mod.defineTool === 'function') cachedDefineTool = mod.defineTool
  } catch (err) {
    console.warn('[dsh-worklog] 没能加载 @deepseek-ai/dsh-tools，工具按裸定义注册：' + String((err && err.message) || err))
  }
  if (!cachedDefineTool) cachedDefineTool = (definition) => definition
  return cachedDefineTool
}

/** 纯文本投影：值已经是结构化的，这里只决定给人看的那一句话。 */
function textRender(fn) {
  return (_args, value) => [{ type: 'text', text: fn(value) }]
}

function statusText(status) {
  return STATUS_LABEL[status] || status || '待开始'
}

function formatLine(task) {
  const priority = PRIORITY_LABEL[task.priority || 'normal'] || '中'
  return task.date + ' · ' + statusText(task.status) + ' · 优先级' + priority
    + (task.project ? ' · ' + task.project : '') + ' · ' + task.title + '  [' + task.id + ']'
}

/**
 * 注册全部工具。
 * @param ctx 宿主上下文（需带 tools 服务）
 * @param getCore () => 当前 core 模块（热重载后拿到的是新的）
 * @returns 反注册函数
 */
export async function registerWorklogTools(ctx, getCore) {
  const defineTool = await loadDefineTool()
  const disposers = []

  const register = (definition) => {
    try {
      disposers.push(ctx.tools.register(defineTool(definition)))
    } catch (err) {
      console.warn('[dsh-worklog] 注册工具失败 ' + definition.name + '：' + String((err && err.message) || err))
    }
  }

  // 没有 tools 服务（或宿主版本不提供）时安静退出：工具缺失不该影响别的功能。
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    return { count: 0, dispose: () => {} }
  }

  const taskOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true, description: '任务 id（后续 update 用它）' },
        title: { type: 'string', required: true, description: '任务标题' },
        date: { type: 'string', required: true, description: '归属日期 YYYY-MM-DD' },
        status: { type: 'string', required: true, description: 'todo | doing | done | blocked' },
        priority: { type: 'string', required: true, description: 'low | normal | high' },
        project: { type: 'string', required: true, description: '项目名，空串表示未归类' },
      },
    },
    render: textRender((v) => '已保存：' + formatLine(v)),
  }

  const toOutput = (task) => ({
    id: task.id,
    title: task.title,
    date: task.date,
    status: task.status,
    priority: task.priority || 'normal',
    project: task.project || '',
  })

  register({
    name: 'worklog_add',
    description: [
      '在工作记录里新增一条任务，默认记在今天、状态为待开始。',
      '当用户说「记一下」「今天做了…」「帮我记个任务」「这件事明天要做」时使用。',
      'project 是自由文本的项目名（如「供应链改造」）；用户没提具体项目就不要猜，留空即可。',
      'date 用 YYYY-MM-DD；用户说「明天」「下周一」时按会话当前时间换算成具体日期再传。',
    ].join(''),
    parameters: {
      title: { type: 'string', required: true, description: '任务标题，一句话，会原样显示在日历里' },
      project: { type: 'string', description: '项目名；不确定就不传' },
      date: { type: 'string', description: '归属日期 YYYY-MM-DD，默认今天' },
      status: { type: 'string', description: 'todo | doing | done | blocked，默认 todo' },
      priority: { type: 'string', description: '优先级 low | normal | high，默认 normal；用户说「急」「重要」用 high' },
      note: { type: 'string', description: '备注，可选' },
    },
    output: taskOutput,
    execute: async (args, exec) => {
      if (exec && exec.signal) exec.signal.throwIfAborted()
      const task = getCore().saveTask({
        title: args.title,
        project: args.project,
        date: args.date,
        status: args.status,
        priority: args.priority,
        note: args.note,
      })
      return toOutput(task)
    },
  })

  register({
    name: 'worklog_update',
    description: [
      '修改已有任务：改标题、挪日期、切状态（例如「把那条标记为已完成」）、改项目、改优先级、改备注。',
      '必须传 id（可先用 worklog_list 拿到）。只传要改的字段，其余保持不变。',
    ].join(''),
    parameters: {
      id: { type: 'string', required: true, description: '任务 id' },
      title: { type: 'string', description: '新标题' },
      project: { type: 'string', description: '新项目名；传空串表示改为未归类' },
      date: { type: 'string', description: '新的归属日期 YYYY-MM-DD' },
      status: { type: 'string', description: 'todo | doing | done | blocked' },
      priority: { type: 'string', description: 'low | normal | high' },
      note: { type: 'string', description: '新备注' },
    },
    output: taskOutput,
    execute: async (args, exec) => {
      if (exec && exec.signal) exec.signal.throwIfAborted()
      const patch = { id: args.id }
      for (const field of ['title', 'project', 'date', 'status', 'priority', 'note']) {
        if (args[field] !== undefined) patch[field] = args[field]
      }
      const task = getCore().saveTask(patch)
      return toOutput(task)
    },
  })

  register({
    name: 'worklog_list',
    description: [
      '查工作记录。条件是可选且可组合的：日期区间、项目、状态、关键词。',
      '用户问「这周做了什么」「供应链改造还有哪些没完成」「今天记了什么」时使用。',
      '返回 count 和 summary；summary 每行末尾的方括号里是任务 id，可以直接拿去 worklog_update。',
    ].join(''),
    parameters: {
      from: { type: 'string', description: '起始日期 YYYY-MM-DD（含）' },
      to: { type: 'string', description: '结束日期 YYYY-MM-DD（含）' },
      project: { type: 'string', description: '只看这个项目' },
      status: { type: 'string', description: '只看这个状态：todo | doing | done | blocked' },
      priority: { type: 'string', description: '只看这个优先级：low | normal | high' },
      keyword: { type: 'string', description: '在标题 / 备注 / 项目名里搜索' },
      limit: { type: 'number', description: '最多返回多少条，默认 100，上限 500' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true, description: '匹配到的总条数' },
          summary: { type: 'string', required: true, description: '每条任务一行，行尾方括号内是任务 id' },
        },
      },
      render: textRender((v) => (v.count === 0 ? '没有匹配的任务。' : v.summary)),
    },
    execute: async (args, exec) => {
      if (exec && exec.signal) exec.signal.throwIfAborted()
      const result = getCore().listTasks(args || {})
      const summary = result.tasks.map(formatLine).join('\n')
      return { count: result.total, summary }
    },
  })

  register({
    name: 'worklog_projects',
    description: '列出工作记录里出现过的项目及各自的任务数 / 完成数 / 进行中数。用户问「有几个项目」「哪个项目最忙」时使用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', required: true, description: '项目数' },
          summary: { type: 'string', required: true, description: '每个项目一行' },
        },
      },
      render: textRender((v) => (v.count === 0 ? '还没有任何项目。' : v.summary)),
    },
    execute: async (args, exec) => {
      if (exec && exec.signal) exec.signal.throwIfAborted()
      const projects = getCore().projectSummary()
      const summary = projects
        .map((p) => p.name + '：共 ' + p.total + ' 条，已完成 ' + p.done + '，进行中 ' + p.doing)
        .join('\n')
      return { count: projects.length, summary }
    },
  })

  return {
    count: disposers.length,
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try { dispose() } catch (err) {}
      }
    },
  }
}
