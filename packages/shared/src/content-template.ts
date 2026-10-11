/**
 * 内容模板键的校验工具。
 *
 * 「页面」与「文章」都可以从主题声明的 `pageTemplates` 中选择渲染模板。
 * 校验的唯一权威来源是**当前主题声明的清单**，因此本模块只做纯函数判断，
 * 由调用方（插件）负责从 `core.theme@1` 取到清单。
 *
 * 为什么必须在保存时校验：主题切换或主题升级后，旧键可能已不存在。
 * 若不校验，用户会看到"选了模板却没生效"的静默降级，极难排查；
 * 渲染期仍会做一次优雅回退（键失效不报错），两处配合才既不静默也不脆弱。
 */

import { ErrorCode, RiceNoteError } from './errors.js';
import type { PageTemplateDescriptor } from './types/dto.js';

const MAX_TEMPLATE_KEY_LENGTH = 120;

/**
 * 校验并归一化内容所选的模板键。
 *
 * @param raw 内容中保存的模板键；空值表示"使用主题的默认 kind 模板"。
 * @param available 当前主题声明的可选模板清单。
 * @returns 归一化后的模板键；空输入返回 null。
 */
export function resolveContentTemplateKey(
  raw: string | null | undefined,
  available: readonly PageTemplateDescriptor[]
): string | null {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length === 0) return null;

  if (key.length > MAX_TEMPLATE_KEY_LENGTH) {
    throw new RiceNoteError(
      ErrorCode.CONTENT_TEMPLATE_INVALID,
      `模板键过长（不得超过 ${MAX_TEMPLATE_KEY_LENGTH} 字符）`,
      { status: 400 }
    );
  }

  if (available.length === 0) {
    throw new RiceNoteError(
      ErrorCode.CONTENT_TEMPLATE_INVALID,
      '当前主题未声明任何可选模板，请先在 theme.json 中配置 pageTemplates',
      { status: 400 }
    );
  }

  if (!available.some((item) => item.key === key)) {
    throw new RiceNoteError(ErrorCode.CONTENT_TEMPLATE_INVALID, `当前主题不支持该模板：${key}`, {
      status: 400,
      details: { key, available: available.map((item) => item.key) }
    });
  }

  return key;
}
