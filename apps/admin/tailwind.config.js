/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  /*
   * content 必须包含 SDK 源码与插件自带界面：
   * UI 组件搬进 `packages/admin-sdk` 后，若只扫描 `./src`，组件用到的工具类
   * 会被 Tailwind 当作未使用而清除，插件界面挂到宿主 DOM 后就会缺样式
   * （这是"零构建 + 动态挂载"最容易踩的坑）。
   *
   * 注意：content 扫描发生在构建期，因此**运行时才安装的第三方插件**不在其中，
   * 它们只能使用下面的 safelist（受控工具类白名单）与 SDK 组件。
   */
  content: [
    './index.html',
    './src/**/*.{vue,ts,tsx}',
    '../../packages/admin-sdk/src/**/*.{vue,ts}',
    '../../plugins/*/*/admin/**/*.{js,css}'
  ],
  /*
   * 受控工具类白名单：插件界面（尤其是运行时安装的第三方插件）可用这些类。
   * 只收录布局、间距、排版、状态色等"不会污染宿主外观"的安全子集，
   * 不含阴影与毛玻璃类（视觉硬约束）。
   */
  safelist: [
    // 布局与对齐
    'flex', 'inline-flex', 'flex-col', 'flex-1', 'flex-wrap', 'items-center', 'items-start',
    'justify-between', 'justify-end', 'justify-center', 'gap-1', 'gap-1.5', 'gap-2', 'gap-3', 'gap-4',
    'grid', 'grid-cols-2', 'grid-cols-3', 'col-span-2', 'min-w-0', 'w-full', 'shrink-0',
    // 间距
    'mt-0.5', 'mt-1', 'mt-2', 'mt-3', 'mt-4', 'mb-1', 'mb-2', 'mb-4',
    'ml-1', 'ml-auto', 'mr-1', 'pt-2', 'pt-3', 'pt-4', 'pb-2', 'pb-4',
    'px-2', 'px-3', 'px-4', 'py-1', 'py-2', 'py-3', 'py-4', 'p-3', 'p-4', 'p-5', 'p-6', 'py-12',
    // 排版
    'text-[11px]', 'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
    'font-medium', 'font-semibold', 'font-mono', 'leading-relaxed', 'text-center', 'text-right',
    'truncate', 'line-clamp-1', 'whitespace-nowrap', 'uppercase', 'tracking-wide', 'break-all',
    // 语义色（与设计令牌一致）
    'text-foreground', 'text-muted-foreground', 'text-primary', 'text-destructive',
    'text-success', 'text-warning', 'border-border', 'border-warning', 'border-destructive',
    'border-success', 'bg-card', 'bg-muted', 'bg-accent', 'bg-primary', 'bg-warning/10',
    'bg-destructive/10', 'bg-success/10', 'bg-muted/40', 'rounded-md', 'rounded-lg', 'rounded-full',
    // 尺寸与滚动
    'h-3.5', 'h-4', 'h-5', 'h-8', 'h-9', 'w-3.5', 'w-4', 'w-5', 'w-12', 'w-32', 'w-56',
    'max-w-xl', 'max-w-2xl', 'max-w-4xl', 'overflow-hidden', 'overflow-x-auto', 'overflow-y-auto'
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      fontFamily: {
        sans: ['PingFang SC', 'Helvetica Neue', 'system-ui', 'sans-serif'],
        mono: ['SFMono-Regular', 'Consolas', 'monospace']
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};
