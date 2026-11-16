import http from 'node:http'
import { apply, Config, name, inject } from './lib/index.js'

// --- Config Standard Schema check ---
const validated = Config['~standard'].validate({})
if (validated.issues) throw new Error('Config defaults failed: ' + JSON.stringify(validated.issues))
console.log('CONFIG_OK', JSON.stringify(validated.value))

// --- Register tools into a mock ctx ---
const registered = []
const ctx = { tools: { register: (t) => registered.push(t) } }
apply(ctx, {})
const names = registered.map((t) => t.name)
if (names.length !== 19) throw new Error('expected 19 tools, got ' + names.length)
for (const n of names) if (!n.startsWith('huobao_')) throw new Error('bad prefix: ' + n)
console.log('TOOLS_OK', names.length, names.join(','))

// --- Every tool must have parameters schema + output.schema + output.render + execute ---
for (const t of registered) {
  if (!t.parameters || t.parameters.type !== 'object') throw new Error(t.name + ' bad parameters')
  if (!t.output || !t.output.schema || typeof t.output.render !== 'function') throw new Error(t.name + ' bad output')
  if (typeof t.execute !== 'function') throw new Error(t.name + ' bad execute')
}
console.log('SHAPES_OK')

// --- Mock backend: record requests, return envelope {code,data,message} ---
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, body })
    res.setHeader('content-type', 'application/json')
    const u = req.url.split('?')[0]
    if (u === '/api/v1/health') return res.end(JSON.stringify({ code: 200, data: { status: 'ok', version: '1.0.0', timestamp: 'now' }, message: 'success' }))
    if (u === '/api/v1/dramas' && req.method === 'GET') return res.end(JSON.stringify({ code: 200, data: { items: [{ id: 1, title: '测试剧', status: 'draft', total_episodes: 3 }], pagination: { page: 1, total: 1, total_pages: 1 } }, message: 'success' }))
    if (u === '/api/v1/dramas' && req.method === 'POST') return res.end(JSON.stringify({ code: 201, data: { id: 7 }, message: 'created' }))
    if (u === '/api/v1/tasks/42') return res.end(JSON.stringify({ code: 200, data: { id: 42, type: 'video', status: 'completed', stage: 'done', provider: 'mock', url: 'http://x/out.mp4' }, message: 'success' }))
    res.statusCode = 404
    res.end(JSON.stringify({ code: 404, message: 'not found' }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

// create a fresh client against the mock server
const registered2 = []
const ctx2 = { tools: { register: (t) => registered2.push(t) } }
apply(ctx2, { baseUrl: 'http://127.0.0.1:' + port })
const byName = Object.fromEntries(registered2.map((t) => [t.name, t]))

const r1 = await byName.huobao_health_check.execute({})
if (String(r1).indexOf('1.0.0') < 0) throw new Error('health render wrong: ' + r1)
const r2 = await byName.huobao_list_dramas.execute({})
if (String(r2).indexOf('测试剧') < 0) throw new Error('list render wrong: ' + r2)
const r3 = await byName.huobao_create_drama.execute({ title: '新剧', genre: '悬疑' })
if (String(r3).indexOf('#7') < 0) throw new Error('create render wrong: ' + r3)
const r4 = await byName.huobao_get_task_status.execute({ id: 42 })
if (String(r4).indexOf('out.mp4') < 0) throw new Error('task render wrong: ' + r4)

// required-arg validation must reject
let rejected = false
try { await byName.huobao_get_drama.execute({}) } catch (e) { rejected = /missing required property/.test(String(e)) }
if (!rejected) throw new Error('required validation did not fire')

console.log('REQUESTS_OK', JSON.stringify(seen))
server.close()
console.log('VERIFY_ALL_OK')
