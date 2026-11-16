/**
 * bridge.js —— 火宝短剧后端 HTTP 桥接的传输层。
 *
 * 只依赖 Node 22+ 的全局 fetch，不引入任何第三方包（插件从 profile 的
 * node_modules 真实路径加载，裸导入 @deepseek-ai/* 会 ERR_MODULE_NOT_FOUND）。
 *
 * 后端所有业务接口返回统一信封：{ code, data, message }。
 * 本模块负责：拼 URL、超时、拆信封、把非 2xx 的 code 变成可读错误。
 */

/** 规整 apiPrefix：缺省 /api/v1；允许传空串表示不加前缀。 */
export function normalizePrefix(p) {
  if (p === undefined || p === null || p === '') return '/api/v1'
  let s = String(p).trim().replace(/\/+$/, '')
  if (!s.startsWith('/')) s = '/' + s
  return s === '/' ? '' : s
}

/** 拼接 base + prefix + path + query（query 里空值自动跳过）。 */
export function buildUrl(base, prefix, path, query) {
  let p = String(path ?? '').trim()
  if (!p.startsWith('/')) p = '/' + p
  let full = String(base).replace(/\/+$/, '') + prefix + p
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    const us = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((item) => us.append(k, String(item)))
      else us.append(k, String(v))
    }
    const qs = us.toString()
    if (qs) full += (full.includes('?') ? '&' : '?') + qs
  }
  return full
}

/** 拆信封：code 2xx 返回 data；否则抛可读错误。 */
export function unwrap(payload, status, method, path) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'code' in payload) {
    const code = Number(payload.code)
    if (Number.isFinite(code) && code >= 200 && code < 300) {
      return { code, data: payload.data ?? null, message: payload.message ?? '' }
    }
    throw new Error(`火宝后端返回错误 ${code}（${method} ${path}）：${payload.message || '未提供错误信息'}`)
  }
  if (status >= 400) {
    throw new Error(`火宝后端 HTTP ${status}（${method} ${path}）：${typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300)}`)
  }
  return { code: status, data: payload ?? null, message: '' }
}

/** 创建一个绑定到某套配置的请求器。 */
export function createClient(config, ctx) {
  const base = String(config.baseUrl || 'http://127.0.0.1:5679')
  const prefix = normalizePrefix(config.apiPrefix)
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 60000

  async function request(method, path, opts = {}) {
    const { query, body, raw } = opts
    const url = buildUrl(base, prefix, path, query)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, {
        method: String(method).toUpperCase(),
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`请求火宝后端超时（${timeoutMs}ms）：${method} ${path}`)
      }
      throw new Error(
        `连不上火宝短剧后端 ${base}：${err.message}。` +
        '请确认后端已启动（在仓库 backend 目录运行 npm run dev，默认端口 5679），' +
        '或在插件配置里改 baseUrl / apiPrefix。'
      )
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let payload
    try { payload = text ? JSON.parse(text) : {} }
    catch {
      if (raw) return { httpStatus: res.status, text }
      throw new Error(`火宝后端返回非 JSON（HTTP ${res.status}）：${text.slice(0, 300)}`)
    }
    if (raw) return { httpStatus: res.status, payload }
    return unwrap(payload, res.status, String(method).toUpperCase(), path)
  }

  return {
    base,
    prefix,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, query) => request('POST', path, { body, query }),
    put: (path, body, query) => request('PUT', path, { body, query }),
    del: (path, query) => request('DELETE', path, { query }),
    request,
  }
}

/** 把后端的 snake_case 对象投影成「人话」表格行，供 render 使用。 */
export function brief(item, keys = ['id', 'title', 'name', 'status', 'updated_at']) {
  if (!item || typeof item !== 'object') return String(item ?? '')
  const parts = []
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== '') parts.push(`${k}: ${item[k]}`)
  }
  return parts.length ? parts.join(' · ') : JSON.stringify(item).slice(0, 200)
}
