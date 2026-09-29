/**
 * 设计令牌：与主界面交互原型 console-mockup.html 1:1 对齐。
 * 方向 —— 深海军蓝玻璃拟态 + 青(#22D3EE)→靛(#6366F1)渐变强调 + 状态机微动效。
 * 颜色统一写 hex，方便使用 /opacity 修饰符；玻璃感由 bg-card/70 + backdrop-blur 组合实现。
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B1220',
        panel: '#111827',
        card: '#111827',
        cardhover: '#1B2436',
        line: '#19202D',
        linestrong: '#283040',
        txt: '#E5E7EB',
        sub: '#94A3B8',
        dim: '#64748B',
        accent: {
          DEFAULT: '#22D3EE',
          soft: '#38BDF8'
        },
        grape: '#6366F1',
        ok: '#34D399',
        warn: '#FBBF24',
        bad: '#F87171',
        manual: '#FBBF24'
      },
      fontFamily: {
        sans: ['"Microsoft YaHei UI"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(34,211,238,.35), 0 6px 24px rgba(34,211,238,.14)',
        card: '0 2px 8px rgba(0,0,0,.35)',
        dock: '0 8px 28px rgba(0,0,0,.45)'
      },
      borderRadius: {
        xl: '0.875rem'
      }
    }
  },
  plugins: []
}
