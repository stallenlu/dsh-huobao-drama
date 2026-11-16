// dsh-huobao-drama · 浏览器半边
//   侧栏加「火宝短剧」入口，主区域用 iframe 嵌入火宝短剧 Web UI（http://127.0.0.1:5679/）。
//   后端由独立任务 HuobaoDramaBackend 保活；这里只做嵌入，不代理、不改宿主工具逻辑。
window.__ModuleLoader__.load({
  id: 'dsh-huobao-drama',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const PANEL = 'huobao-drama'
    const SRC = 'http://127.0.0.1:5679/'
    const LABEL = '火宝短剧'

    function DramaIcon(props) {
      const s = (props && props.size) || 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
        h('path', { d: 'M7 5v14M17 5v14M3 10h18M3 14h18' }))
    }

    function apply(ctx) {
      function DramaPanel() {
        return h('iframe', {
          src: SRC,
          title: LABEL,
          allow: 'fullscreen; autoplay',
          style: { width: '100%', height: '100%', border: 0, display: 'block' },
        })
      }
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 7, label: () => LABEL }, DramaIcon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, DramaPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
