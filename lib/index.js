/**
 * dsh-huobao-drama —— 把 chatfire-AI/huobao-drama 后端能力桥接成 DSH Agent 工具。
 * 不内嵌整部应用、不做 UI；只把火宝短剧后端 HTTP API 包装成 19 个 huobao_* 工具，
 * 让大模型用「人话」驱动：建剧 → 改剧本 → 抽素材 → 分镜 → 出图/视频 → 合成片。
 * 后端需另行启动（默认 http://127.0.0.1:5679）。只依赖 Node 内建模块 + 本包模块。
 */
import { config, defineTool } from './toolkit.js'
import { createClient, brief } from './bridge.js'

export const name = 'huobao-drama'
export const inject = ['tools']

const DEFAULT_CONFIG = Object.freeze({
  baseUrl: 'http://127.0.0.1:5679',
  apiPrefix: '/api/v1',
  timeoutMs: 60000,
})

export const Config = config(DEFAULT_CONFIG, (v) => {
  const issues = []
  if (typeof v.baseUrl !== 'string' || !(v.baseUrl.indexOf('http://') === 0 || v.baseUrl.indexOf('https://') === 0)) {
    issues.push('baseUrl must be an http(s) URL, e.g. http://127.0.0.1:5679')
  }
  if (typeof v.apiPrefix !== 'string') issues.push('apiPrefix must be a string')
  if (!Number.isFinite(v.timeoutMs) || v.timeoutMs < 1000) issues.push('timeoutMs must be a number >= 1000')
  return issues
})

function resolveConfig(raw) {
  const cfg = raw ?? {}
  const out = {}
  for (const [key, fallback] of Object.entries(DEFAULT_CONFIG)) {
    const v = cfg[key]
    if (v === undefined) { out[key] = fallback; continue }
    if (typeof fallback === 'number') out[key] = Number.isFinite(v) ? v : fallback
    else out[key] = typeof v === 'string' ? v : fallback
  }
  return out
}

const NL = String.fromCharCode(10)
function line(item, keys) { return brief(item, keys) }
function lines(items, keys, empty) {
  if (!Array.isArray(items) || !items.length) return empty || '（无）'
  return items.map((x) => '- ' + line(x, keys)).join(NL)
}
function text(value) {
  if (value === null || value === undefined) return '（空）'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((x) => typeof x === 'string' ? x : line(x, ['id', 'name', 'title', 'status'])).join('; ')
  return line(value, ['id', 'title', 'name', 'status', 'result', 'final_prompt', 'url', 'message'])
}
const renderText = (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }]

export function apply(ctx, rawConfig) {
  const cfg = resolveConfig(rawConfig)
  const client = createClient(cfg, ctx)
  const T = (opts) => defineTool({ ...opts, render: opts.render ?? renderText })

  ctx.tools.register(T({
    name: 'huobao_list_dramas',
    description: '列出火宝短剧里的剧本项目（支持分页/状态/关键词筛选），返回每部剧的集数、角色、场景数量。',
    parameters: {
      page: { type: 'number', description: '页码，从 1 开始' },
      page_size: { type: 'number', description: '每页条数' },
      status: { type: 'string', description: '按状态筛选，如 draft' },
      keyword: { type: 'string', description: '标题关键词' },
    },
    async execute(args) {
      const d = (await client.get('/dramas', args)).data ?? {}
      const items = d.items ?? [], p = d.pagination ?? {}
      return '共 ' + (p.total ?? items.length) + ' 部短剧（第 ' + (p.page ?? 1) + '/' + (p.total_pages ?? 1) + ' 页）：' + NL +
        lines(items, ['id', 'title', 'status', 'genre', 'total_episodes'])
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_get_drama',
    description: '获取某部短剧的完整详情：剧名、状态、集数、角色、场景、道具。',
    parameters: { id: { type: 'number', required: true, description: '剧本项目 ID' } },
    async execute(args) {
      const d = (await client.get('/dramas/' + args.id)).data ?? {}
      const eps = d.episodes ?? [], chars = d.characters ?? [], scenes = d.scenes ?? [], props = d.props ?? []
      return '短剧 #' + (d.id ?? args.id) + '《' + (d.title ?? '') + '》[' + (d.status ?? '') + ']' + NL +
        '集数 ' + eps.length + ' · 角色 ' + chars.length + '：' + (chars.map((c) => c.name).filter(Boolean).join('、') || '无') + NL +
        '场景 ' + scenes.length + ' · 道具 ' + props.length +
        (d.genre ? NL + '类型：' + d.genre : '') + (d.style ? '  风格：' + d.style : '')
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_create_drama',
    description: '新建一部短剧项目（初始状态为草稿），返回新剧 ID。',
    parameters: {
      title: { type: 'string', required: true, description: '剧名' },
      description: { type: 'string', description: '剧情简介' },
      genre: { type: 'string', description: '题材类型' },
      style: { type: 'string', description: '风格' },
      aspect_ratio: { type: 'string', description: '画面比例，默认 16:9' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
    },
    async execute(args) {
      const d = (await client.post('/dramas', args)).data ?? {}
      return '已创建短剧 #' + (d.id ?? '?') + '《' + args.title + '》（草稿）。可继续用 huobao_create_episode 添加剧集。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_create_episode',
    description: '给某部短剧新增一集，并锁定该集的图像/视频模型配置。',
    parameters: {
      drama_id: { type: 'number', required: true, description: '所属短剧 ID' },
      title: { type: 'string', description: '剧集标题' },
      resolution: { type: 'string', enum: ['480p', '720p', '1080p'], description: '分辨率，默认 720p' },
    },
    async execute(args) {
      const d = (await client.post('/episodes', args)).data ?? {}
      return '已创建第 ' + (d.episode_number ?? '?') + ' 集 #' + (d.id ?? '?') + '《' + (d.title ?? '') + '》' +
        '（图像配置=' + (d.image_config_id ?? '默认') + '，视频配置=' + (d.video_config_id ?? '默认') + '，' + (d.resolution ?? '720p') + '）。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_get_pipeline_status',
    description: '查看某集的生产流水线进度：剧本改写、素材抽取、分镜、图片生成、视频生成、合并。',
    parameters: { id: { type: 'number', required: true, description: '剧集 ID' } },
    async execute(args) {
      const d = (await client.get('/episodes/' + args.id + '/pipeline-status')).data ?? {}
      const s = d.steps ?? {}, st = (x) => (x && x.status) || '—'
      return '剧集 ' + (d.episode_id ?? args.id) + ' 流水线：' + NL +
        '- 剧本改写：' + st(s.script_rewrite) + NL +
        '- 角色抽取：' + st(s.extract_characters) + '（' + (s.extract_characters?.count ?? 0) + ' 个）' + NL +
        '- 场景抽取：' + st(s.extract_scenes) + '（' + (s.extract_scenes?.count ?? 0) + ' 个）' + NL +
        '- 分镜拆解：' + st(s.extract_storyboards) + NL +
        '- 图片生成：' + st(s.generate_images) + '（' + (s.generate_images?.completed ?? 0) + '/' + (s.generate_images?.total ?? 0) + '）' + NL +
        '- 视频生成：' + st(s.generate_videos) + '（' + (s.generate_videos?.completed ?? 0) + '/' + (s.generate_videos?.total ?? 0) + '）' + NL +
        '- 合并成片：' + st(s.merge_episode) + (s.merge_episode?.merged_url ? '（' + s.merge_episode.merged_url + '）' : '')
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_agent_chat',
    description: '调用火宝后端的 AI 智能体处理剧本：改写剧本、抽取素材、拆分镜、生成提示词。返回智能体文本与用到的工具。',
    parameters: {
      type: { type: 'string', required: true, enum: ['script_rewriter', 'extractor', 'storyboard_breaker', 'prompt_generator'], description: '智能体类型' },
      message: { type: 'string', required: true, description: '给智能体的指令/剧本内容' },
      drama_id: { type: 'number', required: true, description: '短剧 ID' },
      episode_id: { type: 'number', required: true, description: '剧集 ID' },
      model: { type: 'string', description: '指定模型' },
      config_id: { type: 'number', description: '指定 AI 配置 ID' },
    },
    async execute(args) {
      const d = (await client.post('/agent/' + args.type + '/chat', args)).data ?? {}
      const used = Array.isArray(d.toolCalls) ? d.toolCalls.map((t) => t.toolName).filter(Boolean) : []
      return (d.text || '（智能体无文本输出）') + (used.length ? NL + '（用到工具：' + used.join('、') + '）' : '')
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_update_episode_script',
    description: '把改写好的剧本/正文保存进某集，也可改标题与状态。',
    parameters: {
      id: { type: 'number', required: true, description: '剧集 ID' },
      script_content: { type: 'string', description: '分镜剧本内容' },
      content: { type: 'string', description: '正文内容' },
      title: { type: 'string', description: '剧集标题' },
      status: { type: 'string', description: '状态' },
    },
    async execute(args) {
      const id = args.id, body = { ...args }
      delete body.id
      await client.put('/episodes/' + id, body)
      return '已更新剧集 #' + id + ' 的字段：' + Object.keys(body).join('、') + '。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_extract_assets',
    description: '从某集剧本里异步抽取角色 / 场景 / 道具素材（后台任务，用 huobao_get_extract_status 查进度）。',
    parameters: {
      id: { type: 'number', required: true, description: '剧集 ID' },
      target: { type: 'string', required: true, enum: ['characters', 'scenes', 'props'], description: '抽取目标' },
      model: { type: 'string', description: '指定模型' },
      config_id: { type: 'number', description: '指定 AI 配置 ID' },
    },
    async execute(args) {
      const d = (await client.post('/episodes/' + args.id + '/extract', args)).data ?? {}
      const nm = { characters: '角色', scenes: '场景', props: '道具' }
      return '已为剧集 ' + args.id + ' 启动「' + (nm[args.target] ?? args.target) + '」抽取（已在运行：' + (d.already_running ? '是' : '否') + '）。用 huobao_get_extract_status 查进度。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_get_extract_status',
    description: '查询某集素材抽取的进度。',
    parameters: { id: { type: 'number', required: true, description: '剧集 ID' } },
    async execute(args) {
      const d = (await client.get('/episodes/' + args.id + '/extract-status')).data ?? {}
      if (Array.isArray(d) ? !d.length : !Object.keys(d || {}).length) return '剧集 ' + args.id + ' 暂无抽取任务。'
      const rows = Array.isArray(d) ? d : Object.entries(d).map(([k, v]) => Object.assign({ target: k }, v && typeof v === 'object' ? v : { state: v }))
      return '剧集 ' + args.id + ' 抽取状态：' + NL + lines(rows, ['target', 'status', 'state', 'count', 'name'])
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_generate_video_prompts',
    description: '为某集的分镜批量补全视频提示词（后台任务）。',
    parameters: {
      id: { type: 'number', required: true, description: '剧集 ID' },
      storyboard_ids: { type: 'array', items: { type: 'number' }, description: '指定分镜 ID，省略则为全部' },
      model: { type: 'string', description: '指定模型' },
      config_id: { type: 'number', description: '指定 AI 配置 ID' },
    },
    async execute(args) {
      const d = (await client.post('/episodes/' + args.id + '/generate-video-prompts', args)).data ?? {}
      if (d.status === 'idle') return '剧集 ' + args.id + ' 没有待生成提示词的分镜。'
      return '已启动视频提示词批量生成（' + (d.total ?? '?') + ' 个分镜，已在运行：' + (d.already_running ? '是' : '否') + '）。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_create_storyboard',
    description: '新建一个分镜镜头，并绑定到剧集里的场景/角色/道具。',
    parameters: {
      episode_id: { type: 'number', required: true, description: '剧集 ID' },
      storyboard_number: { type: 'number', description: '镜头序号' },
      title: { type: 'string', description: '镜头标题' },
      description: { type: 'string', description: '镜头描述' },
      scene_id: { type: 'number', description: '绑定场景 ID' },
      duration: { type: 'number', description: '时长（秒），默认 10' },
      character_ids: { type: 'array', items: { type: 'number' }, description: '绑定角色 ID 列表' },
      prop_ids: { type: 'array', items: { type: 'number' }, description: '绑定道具 ID 列表' },
    },
    async execute(args) {
      const d = (await client.post('/storyboards', args)).data ?? {}
      return '已创建分镜 #' + (d.id ?? '?') + '（第 ' + (d.storyboard_number ?? args.storyboard_number ?? '?') + ' 镜）于剧集 ' + args.episode_id + '。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_generate_asset_prompt',
    description: '为场景 / 角色 / 道具生成或重写最终的 AI 绘图提示词（只生成提示词，不出图）。',
    parameters: {
      asset_type: { type: 'string', required: true, enum: ['scenes', 'characters', 'props'], description: '素材类型' },
      id: { type: 'number', required: true, description: '素材 ID' },
      episode_id: { type: 'number', required: true, description: '所属剧集 ID' },
      force: { type: 'boolean', description: '是否强制重新生成' },
      text_model: { type: 'string', description: '提示词文本模型' },
      text_config_id: { type: 'number', description: '提示词文本配置 ID' },
    },
    async execute(args) {
      const body = { ...args }
      delete body.asset_type
      delete body.id
      const d = (await client.post('/' + args.asset_type + '/' + args.id + '/generate-prompt', body)).data ?? {}
      return args.asset_type + ' #' + args.id + ' 的最终提示词：' + NL + (d.final_prompt ?? text(d))
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_generate_asset_image',
    description: '为场景 / 角色 / 道具排队生成图片（后台任务，返回图片任务 ID）。',
    parameters: {
      asset_type: { type: 'string', required: true, enum: ['scenes', 'characters', 'props'], description: '素材类型' },
      id: { type: 'number', required: true, description: '素材 ID' },
      episode_id: { type: 'number', required: true, description: '所属剧集 ID' },
      model: { type: 'string', description: '绘图模型' },
      config_id: { type: 'number', description: '绘图配置 ID' },
      text_model: { type: 'string', description: '提示词文本模型' },
      text_config_id: { type: 'number', description: '提示词文本配置 ID' },
    },
    async execute(args) {
      const body = { ...args }
      delete body.asset_type
      delete body.id
      const d = (await client.post('/' + args.asset_type + '/' + args.id + '/generate-image', body)).data ?? {}
      return '已为 ' + args.asset_type + ' #' + args.id + ' 排队生成图片，任务 ID #' + (d.image_generation_id ?? '?') + '。用 huobao_get_task_status 查进度。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_generate_task',
    description: '提交一个通用的图片或视频生成任务（可指定分镜、提示词、参考图、各种视频参数）。',
    parameters: {
      type: { type: 'string', required: true, enum: ['image', 'video'], description: '任务类型' },
      prompt: { type: 'string', description: '生成提示词' },
      storyboard_id: { type: 'number', description: '关联分镜 ID' },
      drama_id: { type: 'number', description: '关联短剧 ID' },
      scene_id: { type: 'number', description: '关联场景 ID' },
      character_id: { type: 'number', description: '关联角色 ID' },
      config_id: { type: 'number', description: 'AI 配置 ID' },
      model: { type: 'string', description: '模型' },
      size: { type: 'string', description: '图片尺寸，如 1920x1080' },
      frame_type: { type: 'string', description: '帧类型（首帧/尾帧/普通）' },
      reference_images: { type: 'array', items: { type: 'string' }, description: '参考图片 URL 列表' },
      duration: { type: 'number', description: '视频时长（秒）' },
      aspect_ratio: { type: 'string', description: '画面比例' },
      resolution: { type: 'string', description: '分辨率' },
      generate_audio: { type: 'boolean', description: '是否生成音频' },
    },
    async execute(args) {
      const d = (await client.post('/tasks', args)).data ?? {}
      return '已排队 ' + (args.type === 'video' ? '视频' : '图片') + ' 生成任务 #' + (d.id ?? '?') +
        '（状态 ' + (d.status ?? 'processing') + '，阶段 ' + (d.stage ?? 'submitting') + '）。用 huobao_get_task_status 查进度。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_get_task_status',
    description: '查询某个生成任务的当前状态、阶段、提供方、结果与错误信息。',
    parameters: { id: { type: 'number', required: true, description: '任务 ID' } },
    async execute(args) {
      const d = (await client.get('/tasks/' + args.id)).data
      if (!d) return '任务 #' + args.id + ' 不存在。'
      const result = d.resultUrl ?? d.result_url ?? d.url ?? d.localPath ?? d.local_path ?? '—'
      return '任务 #' + args.id + ' [' + (d.type ?? '?') + '] 状态=' + (d.status ?? '?') + ' 阶段=' + (d.stage ?? '?') +
        ' 提供方=' + (d.provider ?? '—') + ' 模型=' + (d.model ?? '—') + NL + '结果：' + result + (d.error ? NL + '错误：' + d.error : '')
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_recover_task',
    description: '重试/恢复一个中断的视频生成任务。',
    parameters: { id: { type: 'number', required: true, description: '任务 ID' } },
    async execute(args) {
      const d = (await client.post('/tasks/' + args.id + '/recover', {})).data ?? {}
      return '已为任务 #' + args.id + ' 启动恢复（返回 ID ' + (d.id ?? args.id) + '）。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_merge_episode',
    description: '把某集的分镜视频按顺序拼接成整集成片（后台任务）。',
    parameters: {
      id: { type: 'number', required: true, description: '剧集 ID' },
      storyboard_ids: { type: 'array', items: { type: 'number' }, description: '指定分镜，省略则全部' },
    },
    async execute(args) {
      const d = (await client.post('/merge/episodes/' + args.id + '/merge', args)).data ?? {}
      return '已启动剧集 ' + args.id + ' 的成片合并，合并任务 #' + (d.merge_id ?? '?') + '（状态 ' + (d.status ?? 'processing') + '）。'
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_list_models_and_configs',
    description: '查看后端可用的 AI 配置、模型提供方或风格预设（用来给其它工具选 config_id / 模型）。',
    parameters: {
      kind: { type: 'string', required: true, enum: ['configs', 'providers', 'presets'], description: '查看哪一类' },
      service_type: { type: 'string', description: '筛选服务类型（configs 时用）' },
      all: { type: 'boolean', description: '是否包含停用的预设（presets 时用）' },
    },
    async execute(args) {
      const map = { configs: '/ai-configs', providers: '/ai-providers', presets: '/style-presets' }
      const query = {}
      if (args.kind === 'configs' && args.service_type) query.service_type = args.service_type
      if (args.kind === 'presets' && args.all) query.all = '1'
      const d = (await client.get(map[args.kind], query)).data ?? []
      const label = { configs: 'AI 配置', providers: '模型提供方', presets: '风格预设' }[args.kind]
      return label + '：' + NL + lines(d, ['id', 'name', 'provider', 'value', 'service_type', 'is_active', 'model'])
    },
  }))

  ctx.tools.register(T({
    name: 'huobao_health_check',
    description: '检查火宝短剧后端是否在线、版本与当前时间（排查连接问题的第一步）。',
    parameters: {},
    async execute() {
      const d = (await client.get('/health')).data ?? {}
      return '火宝后端正常 — 状态 ' + (d.status ?? 'ok') + (d.version ? '，版本 ' + d.version : '') + (d.timestamp ? '，检查于 ' + d.timestamp : '') + '。'
    },
  }))
}
