/**
 * 设计令牌：与 docs/ui-concept（玻璃拟态·板岩蓝冷调概念稿）1:1 对齐。
 * 方向 —— 板岩蓝氛围底 + 白霜玻璃(blur 30px saturate 1.6) + 钢蓝(#2E7FC4)单一强调 + 状态机微动效。
 * 颜色统一写 hex，方便使用 /opacity 修饰符；玻璃感由 bg-card/70 + backdrop-blur 组合实现。
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: '#101B24',
        panel: '#16232E',
        card: '#1C2C3A',
        cardhover: '#26394A',
        line: '#2A3B4A',
        linestrong: '#3A5063',
        txt: '#F2F6FA',
        sub: '#9FB4C4',
        dim: '#6C8496',
        accent: {
          DEFAULT: '#2E7FC4',
          soft: '#8FB6E0'
        },
        grape: '#235F93',
        ok: '#4FD6BC',
        warn: '#F5B954',
        bad: '#F87171',
        manual: '#F5B954'
      },
      fontFamily: {
        sans: ['"Microsoft YaHei UI"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(46,127,196,.38), 0 6px 24px rgba(46,127,196,.15)',
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
