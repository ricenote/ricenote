#!/usr/bin/env node
/**
 * 一次性迁移：wiki 页面从「目录式」改为「扁平前缀式」命名。
 *
 * ⚠️ 该迁移**已完成**（2026-10-12，真实远端预演为 新增 24 / 更新 10 / 删除 24）。
 * 保留本脚本仅为记录映射关系与迁移过程，后续无实际用途，可随时删除；
 * 新页面请直接按扁平命名创建，并由 `pnpm wiki:check` 把关（它会拦住子目录与标题冲突）。
 *
 * 为什么要迁：**GitHub Wiki 不支持用目录组织页面** —— 文件名决定页面标题，
 * 而标题中不允许出现 `/`（GitHub 官方文档「Adding or editing wiki pages」
 * 明确列出标题禁用字符 `\ / : * ? " < > |`）。之前把页面放在 Plugins/、
 * Development/Architecture/ 等目录里，推送后 GitHub 丢掉目录、只取文件名当标题，
 * 于是出现三个「Overview」、两个「Settings」、两个「Getting Started」互相冲突，
 * 绝大多数页面无法按预期 URL 访问（`wiki/_pages` 列表可验证）。
 *
 * 本脚本幂等，可重复执行：
 *   1) 按映射表重命名文件，并清理空目录
 *   2) 改写所有 .md 中的内部链接目标（[[显示文本|目标]]，保留表格里的 \| 转义）
 *
 * 用法：
 *   node scripts/migrate-wiki-layout.mjs --dry-run   # 只打印将做的改动
 *   node scripts/migrate-wiki-layout.mjs             # 实际执行
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = path.join(ROOT, 'wiki');
const dryRun = process.argv.includes('--dry-run');

/** 旧相对路径 → 新文件名（全部扁平）。 */
const RENAMES = [
  ['Plugins/Overview.md', 'Plugins-Overview.md'],
  ['Plugins/Install-and-Update.md', 'Plugins-Install-and-Update.md'],

  ['Development/Index.md', 'Development.md'],
  ['Development/Hooks-Inventory.md', 'Hooks-Inventory.md'],
  ['Development/ADR.md', 'ADR.md'],
  ['Development/Contributing.md', 'Contributing.md'],

  ['Development/Architecture/Overview.md', 'Architecture-Overview.md'],
  ['Development/Architecture/Core-Bootstrap.md', 'Architecture-Core-Bootstrap.md'],
  ['Development/Architecture/Plugin-Lifecycle.md', 'Architecture-Plugin-Lifecycle.md'],
  ['Development/Architecture/Render-Pipeline.md', 'Architecture-Render-Pipeline.md'],
  ['Development/Architecture/Data-and-Migrations.md', 'Architecture-Data-and-Migrations.md'],
  ['Development/Architecture/Security.md', 'Architecture-Security.md'],
  ['Development/Architecture/Extension-Registry.md', 'Architecture-Extension-Registry.md'],

  ['Development/Plugin-API/Getting-Started.md', 'Plugin-API-Getting-Started.md'],
  ['Development/Plugin-API/Manifest-Reference.md', 'Plugin-API-Manifest-Reference.md'],
  ['Development/Plugin-API/Context-Reference.md', 'Plugin-API-Context-Reference.md'],
  ['Development/Plugin-API/Service-Contracts.md', 'Plugin-API-Service-Contracts.md'],
  ['Development/Plugin-API/Admin-UI.md', 'Plugin-API-Admin-UI.md'],
  ['Development/Plugin-API/Settings.md', 'Plugin-API-Settings.md'],
  ['Development/Plugin-API/Tutorial.md', 'Plugin-API-Tutorial.md'],

  ['Development/Theme-API/Overview.md', 'Theme-API-Overview.md'],
  ['Development/Theme-API/Template-Reference.md', 'Theme-API-Template-Reference.md'],
  ['Development/Theme-API/Settings.md', 'Theme-API-Settings.md'],
  ['Development/Theme-API/Slots.md', 'Theme-API-Slots.md']
];

/**
 * 链接目标改写规则。
 *
 * 捕获组 1 保留分隔符原样（普通 `|` 或表格里转义的 `\|`）——
 * 若直接替换成裸 `|` 会把表格单元格拆坏。
 */
const LINK_RULES = [
  [/(\\?\|)Development\/Architecture\/([A-Za-z0-9._-]+)\]\]/g, '$1Architecture-$2]]'],
  [/(\\?\|)Development\/Plugin-API\/([A-Za-z0-9._-]+)\]\]/g, '$1Plugin-API-$2]]'],
  [/(\\?\|)Development\/Theme-API\/([A-Za-z0-9._-]+)\]\]/g, '$1Theme-API-$2]]'],
  [/(\\?\|)Development\/(Hooks-Inventory|ADR|Contributing)\]\]/g, '$1$2]]'],
  [/(\\?\|)Development\/Index\]\]/g, '$1Development]]'],
  [/(\\?\|)Plugins\/([A-Za-z0-9._-]+)\]\]/g, '$1Plugins-$2]]']
];

function walkMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** 自底向上清理空目录（不动 wiki/ 自身）。 */
function pruneEmptyDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    pruneEmptyDirs(full);
    if (readdirSync(full).length === 0) {
      if (dryRun) console.log(`  [dir] 删除空目录 ${path.relative(WIKI_DIR, full)}/`);
      else rmdirSync(full);
    }
  }
}

// ---- 1. 重命名文件 ----
console.log(`\n=== 1/3 重命名 ${RENAMES.length} 个文件 ===`);
let renamed = 0;
for (const [from, to] of RENAMES) {
  const src = path.join(WIKI_DIR, from);
  const dest = path.join(WIKI_DIR, to);
  if (!existsSync(src)) {
    if (existsSync(dest)) console.log(`  [skip] ${from} 已迁移`);
    else console.log(`  [warn] 找不到 ${from}`);
    continue;
  }
  if (existsSync(dest)) {
    console.log(`  [warn] 目标已存在，跳过：${to}`);
    continue;
  }
  console.log(`  ${from}  →  ${to}`);
  if (!dryRun) {
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(src, dest);
  }
  renamed += 1;
}
console.log(`重命名 ${renamed} 个。`);

// ---- 2. 改写内部链接 ----
console.log('\n=== 2/3 改写内部链接目标 ===');
let touched = 0;
let replaced = 0;
for (const file of walkMarkdown(WIKI_DIR)) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  let hits = 0;
  for (const [pattern, replacement] of LINK_RULES) {
    const matched = after.match(pattern);
    if (matched) hits += matched.length;
    after = after.replace(pattern, replacement);
  }
  if (after !== before) {
    console.log(`  ${path.relative(WIKI_DIR, file)}  （${hits} 处）`);
    if (!dryRun) writeFileSync(file, after, 'utf8');
    touched += 1;
    replaced += hits;
  }
}
console.log(`改写 ${touched} 个文件、${replaced} 处链接。`);

// ---- 3. 清理空目录 ----
console.log('\n=== 3/3 清理空目录 ===');
pruneEmptyDirs(WIKI_DIR);

console.log(
  dryRun
    ? '\n（--dry-run：未写入任何改动）'
    : '\n✔ 迁移完成。接着跑：node scripts/publish-wiki.mjs --check'
);
