import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg1: 'var(--bg)',
        bg2: 'var(--bg2)',
        bg3: 'var(--bg3)',
        bg4: 'var(--bg4)',
        b1: 'var(--border)',
        b2: 'var(--border2)',
        tx1: 'var(--text)',
        tx2: 'var(--text2)',
        tx3: 'var(--text3)',
        accent: 'var(--accent)',
        danger: 'var(--danger)',
        star: 'var(--star)',
        hdr: 'var(--hdr)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,122,255,0)' },
          '50%': { boxShadow: '0 0 20px 5px rgba(0,122,255,0.07)' },
        },
        bounceDot: {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(36px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        sheetUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        cardIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 3s ease infinite',
        'bounce-dot': 'bounceDot 1.4s ease infinite',
        'slide-up': 'slideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
        'sheet-up': 'sheetUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'card-in': 'cardIn 0.35s ease both',
      },
    },
  },
  plugins: [],
} satisfies Config
