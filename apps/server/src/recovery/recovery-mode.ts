/**
 * 恢复模式：核心可独立启动的最小界面。
 *
 * 触发条件（任一）：
 * - 数据库不可用；
 * - 没有任何页面提供者插件（即 `router.pages()` 为空）；
 * - 渲染器无法找到可用主题。
 *
 * 该界面不依赖主题、不依赖插件，是"最后一公里"的可用性保障，
 * 同时也是 ADR-005 中"Core 保留最小管理控制面"的落点。
 */

import { escapeHtml } from '@ricenote/core';

export interface RecoveryContext {
  siteTitle: string;
  siteUrl: string;
  version: string;
  reason: string;
  databaseReachable: boolean;
  pluginReport: {
    started: string[];
    failed: { id: string; error: string }[];
    invalid: { dir: string; issues: { path: string; message: string }[] }[];
    dependencyProblems: { pluginId: string; message: string }[];
  };
  themeAvailable: boolean;
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    padding: 3rem 1.25rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f6f7f5;
    color: #1a2b26;
    line-height: 1.7;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  .brand { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 2rem; }
  .brand strong { font-size: 1.25rem; letter-spacing: 0.02em; }
  .brand span { color: #5b6b66; font-size: 0.8125rem; }
  .card {
    background: #fff;
    border: 1px solid #e3e5e1;
    border-radius: 12px;
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.25rem;
  }
  .card h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
  .card p.hint { margin: 0 0 1rem; color: #5b6b66; font-size: 0.875rem; }
  ul { margin: 0.5rem 0 0; padding-left: 1.15rem; }
  li { margin: 0.25rem 0; font-size: 0.9rem; }
  code {
    background: #f1f2ef; border: 1px solid #e3e5e1; border-radius: 5px;
    padding: 0.1rem 0.35rem; font-size: 0.85em;
  }
  pre {
    background: #f1f2ef; border: 1px solid #e3e5e1; border-radius: 8px;
    padding: 0.85rem 1rem; overflow-x: auto; font-size: 0.8125rem; margin: 0.75rem 0 0;
  }
  .badge {
    display: inline-block; font-size: 0.75rem; padding: 0.1rem 0.5rem;
    border-radius: 999px; border: 1px solid #e3e5e1; background: #fafaf8; color: #5b6b66;
  }
  .badge.warn { border-color: #f3d99b; background: #fdf6e6; color: #8a6415; }
  .badge.err { border-color: #f3c2c2; background: #fdeeee; color: #a02c2c; }
  a { color: #0e7c66; }
`.trim();

function badge(text: string, tone: 'warn' | 'err' | 'plain' = 'plain'): string {
  const cls = tone === 'plain' ? 'badge' : `badge ${tone}`;
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/** 渲染恢复模式页面。 */
export function renderRecoveryPage(context: RecoveryContext): string {
  const { pluginReport } = context;

  const failureList = pluginReport.failed.length
    ? `<ul>${pluginReport.failed
        .map((item) => `<li>${badge('启动失败', 'err')} <code>${escapeHtml(item.id)}</code> — ${escapeHtml(item.error)}</li>`)
        .join('')}</ul>`
    : '<p class="hint">没有插件启动失败。</p>';

  const invalidList = pluginReport.invalid.length
    ? `<ul>${pluginReport.invalid
        .map(
          (item) =>
            `<li>${badge('Manifest 非法', 'warn')} <code>${escapeHtml(item.dir)}</code><ul>${item.issues
              .slice(0, 3)
              .map((issue) => `<li>${escapeHtml(issue.path)} — ${escapeHtml(issue.message)}</li>`)
              .join('')}</ul></li>`
        )
        .join('')}</ul>`
    : '<p class="hint">没有清单校验失败。</p>';

  const dependencyList = pluginReport.dependencyProblems.length
    ? `<ul>${pluginReport.dependencyProblems
        .slice(0, 10)
        .map(
          (item) =>
            `<li>${badge('依赖问题', 'warn')} <code>${escapeHtml(item.pluginId)}</code> — ${escapeHtml(item.message)}</li>`
        )
        .join('')}</ul>`
    : '<p class="hint">依赖解析未发现问题。</p>';

  const started = pluginReport.started.length
    ? `<ul>${pluginReport.started.map((id) => `<li>${badge('运行中')} <code>${escapeHtml(id)}</code></li>`).join('')}</ul>`
    : '<p class="hint">当前没有正在运行的插件。</p>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(context.siteTitle)} · 安装与维护</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <strong>RiceNote</strong>
      <span>v${escapeHtml(context.version)} · 安装与维护模式</span>
    </div>

    <div class="card">
      <h2>站点暂未就绪</h2>
      <p class="hint">${escapeHtml(context.reason)}</p>
      <p>
        ${context.databaseReachable ? badge('数据库已连接') : badge('数据库不可用', 'err')}
        ${context.themeAvailable ? badge('主题可用') : badge('无可用主题', 'warn')}
      </p>
      <p class="hint">这是 RiceNote 的恢复模式：内核不依赖任何业务插件即可启动，
      便于管理员定位并修复问题。公开站点在修复前不会对外展示内容。</p>
    </div>

    <div class="card">
      <h2>快速修复步骤</h2>
      <ol>
        <li>确认 <code>.env</code> 中的数据库连接正确，且 MySQL 正在运行。</li>
        <li>执行 <code>pnpm build</code> 编译 Core、SDK 与官方插件。</li>
        <li>执行 <code>pnpm migrate</code> 初始化数据库结构。</li>
        <li>检查 <code>RICENOTE_SEED_PLUGINS</code> 是否包含 <code>posts</code> 等内容插件，然后重启服务。</li>
      </ol>
      <pre>pnpm install
pnpm build
pnpm migrate
pnpm start</pre>
    </div>

    <div class="card">
      <h2>插件运行状态</h2>
      ${started}
      ${failureList}
    </div>

    <div class="card">
      <h2>依赖解析</h2>
      ${dependencyList}
    </div>

    <div class="card">
      <h2>Manifest 校验</h2>
      ${invalidList}
    </div>

    <div class="card">
      <h2>管理入口</h2>
      <p class="hint">管理后台为独立 SPA，开发模式下默认运行在 Vite 开发服务器。</p>
      <p><a href="/api/health">/api/health</a> · <a href="/api/admin/session">/api/admin/session</a></p>
    </div>
  </div>
</body>
</html>`;
}

/** 数据库完全不可用时的降级页面（此时拿不到插件信息）。 */
export function renderDatabaseDownPage(input: {
  siteTitle: string;
  version: string;
  error: string;
  host: string;
  port: number;
  database: string;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(input.siteTitle)} · 数据库不可用</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="brand"><strong>RiceNote</strong><span>v${escapeHtml(input.version)}</span></div>
    <div class="card">
      <h2>无法连接数据库</h2>
      <p class="hint">${escapeHtml(input.error)}</p>
      <p>目标：<code>${escapeHtml(input.host)}:${input.port}/${escapeHtml(input.database)}</code></p>
      <pre># 检查 MySQL 是否可访问
mysql -h ${escapeHtml(input.host)} -P ${input.port} -u root -p

# 确认 .env 中的 DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME</pre>
    </div>
  </div>
</body>
</html>`;
}
