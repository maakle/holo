import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-subtle': 'var(--text-subtle)',
        accent: {
          DEFAULT: 'var(--accent)',
          fg: 'var(--accent-fg)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        'code-bg': 'var(--code-bg)',
      },
      fontFamily: {
        sans: [
          'Geist',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        display: [
          'General Sans',
          'Geist',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      fontSize: {
        'display-1': ['48px', { lineHeight: '56px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'display-2': ['36px', { lineHeight: '44px', letterSpacing: '-0.01em', fontWeight: '600' }],
        h1: ['28px', { lineHeight: '36px', letterSpacing: '-0.01em', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '30px', fontWeight: '500' }],
        h3: ['18px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '24px' }],
        'body-sm': ['13px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '500' }],
        mono: ['13px', { lineHeight: '20px' }],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        full: '9999px',
      },
      transitionTimingFunction: {
        enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
        exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
      },
      transitionDuration: {
        micro: '100ms',
        short: '200ms',
        medium: '300ms',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 200ms ease-out',
        'accordion-up': 'accordion-up 200ms ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
