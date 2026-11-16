// smoke.mjs —— 不依赖 DSH 运行时，验证桥接传输层与工具构造器的纯逻辑。
import assert from 'node:assert/strict'
import { buildUrl, unwrap, normalizePrefix, brief, createClient } from './lib/bridge.js'
import { defineTool, config, toJsonSchema, validateArgs } from './lib/toolkit.js'

// --- 传输层 ---
assert.equal(normalizePrefix(undefined), '/api/v1')
assert.equal(normalizePrefix('/custom/'), '/custom')
assert.equal(normalizePrefix(''), '/api/v1')
assert.equal(normalizePrefix('/'), '')