/**
 * 启动摘要横幅。
 *
 * 背景：启动过程会写多条 JSON 日志（配置、数据库、迁移、主题、插件、HTTP），
 * 逐条读起来费力，且关键结论（几个插件失败、监听在哪个地址）淹没在细节里。
 *
 * 因此这里在 bootstrap 成功/失败后**汇总输出一个对齐的摘要块**：
 * - 关键结论一眼可见（失败项单独列出且不静默）；
 * - 仍是纯文本，可被 `> file` 重定向保存；
 * - 与日志文件中的 JSON Lines 互不干扰（横幅不写文件）。
 */

import type { LogFormat } from './logger.js';

export interface StartupBannerInput {
  version: string;
  env: string;
  node: string;
  rootDir: string;
  database: { host: string; port: number; name: string; latencyMs: number | null };
  theme: { id: string; name: string; version: string } | null;
  plugins: {
    started: string[];
    failed: { id: string; error: string }[];
    excluded: string[];
    invalid: { dir: string; id?: string; message?: string }[];
  };
  routes: { pages: number; admin: number; raw: number };
  services: number;
  slots: number;
  events: number;
  http: { host: string; port: number; siteUrl: string };
  /** 启动耗时（毫秒）。 */
  durationMs: number;
  /**
   * 本次启动所消费掉的"待生效变更"原因。
   *
   * 用于确认"为了应用某项改动而重启"这一路径确实生效：
   * 例如 `已应用：插件设置已保存，重启后生效`。
   */
  appliedPendingChange?: string;
}

const WIDTH = 72;

function rule(char = '─'): string {
  return char.repeat(WIDTH);
}

/** 生成启动摘要文本（不含尾随换行）。 */
export function renderStartupBanner(input: StartupBannerInput): string {
  const lines: string[] = [];
  const row = (label: string, value: string): string => `  ${label.padEnd(10)}${value}`;

  lines.push(rule('='));
  lines.push(`  RiceNote ${input.version}   ·   ${input.env}   ·   Node ${input.node}`);
  lines.push(`  根目录 ${input.rootDir}`);
  lines.push(rule());

  const latency = input.database.latencyMs === null ? '未知' : `${input.database.latencyMs}ms`;
  lines.push(
    row('数据库', `${input.database.host}:${input.database.port}/${input.database.name}  (${latency})`)
  );
  lines.push(
    row(
      '主题',
      input.theme ? `${input.theme.name} ${input.theme.version}  (${input.theme.id})` : '无可用主题'
    )
  );

  const pluginSummary = [
    `已启动 ${input.plugins.started.length}`,
    `失败 ${input.plugins.failed.length}`,
    `排除 ${input.plugins.excluded.length}`,
    `无效 ${input.plugins.invalid.length}`
  ].join('  ·  ');
  lines.push(row('插件', pluginSummary));

  lines.push(
    row(
      '路由',
      `页面 ${input.routes.pages}  ·  管理 API ${input.routes.admin}  ·  原始 ${input.routes.raw}`
    )
  );
  lines.push(row('注册表', `服务 ${input.services}  ·  插槽 ${input.slots}  ·  事件订阅 ${input.events}`));
  lines.push(row('监听', `http://${input.http.host}:${input.http.port}`));
  lines.push(
    row(
      '访问',
      `${input.http.siteUrl}  /  后台 ${input.http.siteUrl.replace(/\/+$/, '')}/admin/`
    )
  );
  lines.push(row('启动耗时', `${input.durationMs}ms`));

  if (input.appliedPendingChange) {
    lines.push(rule());
    lines.push(`  本次启动已应用：${input.appliedPendingChange}`);
  }

  // 失败项必须显式列出：静默的失败比崩溃更难排查
  if (input.plugins.failed.length > 0 || input.plugins.invalid.length > 0 || input.plugins.excluded.length > 0) {
    lines.push(rule());
    for (const item of input.plugins.failed) {
      lines.push(`  [失败] ${item.id}  ${item.error}`);
    }
    for (const id of input.plugins.excluded) {
      lines.push(`  [排除] ${id}  依赖未满足`);
    }
    for (const item of input.plugins.invalid) {
      lines.push(`  [无效] ${item.id ?? item.dir}  ${item.message ?? 'Manifest 校验未通过'}`);
    }
  }

  lines.push(rule('='));
  return lines.join('\n');
}

/** 渲染并输出到 stdout（`format === 'json'` 时不输出，避免污染日志采集）。 */
export function printStartupBanner(input: StartupBannerInput, format: LogFormat, stream = process.stdout): void {
  if (format === 'json') return;
  stream.write(`${renderStartupBanner(input)}\n`);
}
