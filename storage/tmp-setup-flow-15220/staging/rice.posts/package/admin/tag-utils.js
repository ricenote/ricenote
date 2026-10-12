/**
 * 标签输入的**纯逻辑**（不 import SDK，可被 node:test 直接加载）。
 *
 * 为什么单独一份：这几条规则（什么算"同一个标签"、回车该做什么）决定了
 * "会不会白撞 409""无权限时会不会悄悄创建"这类关键行为，值得脱离浏览器单测。
 */

/**
 * 归一化：去首尾空白 + 折叠大小写。
 *
 * 只用于**比较**，不用于展示或提交 —— 展示/创建仍保留用户输入的原始大小写，
 * 否则用户输入的 "Vue.js" 会被落库成 "vue.js"。
 */
export function normalizeTagName(name) {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * 在词条列表里按名称找已有**标签**。
 *
 * 只认 `type === 'tag'`：分类与标签可能重名（比如都叫「架构」），混在一起判断
 * 会让"输入即选中"选到分类，而提交的 `termIds` 是分类与标签共用的一个数组。
 */
export function findExistingTag(tags, name) {
  const target = normalizeTagName(name);
  if (!target) return null;
  const list = Array.isArray(tags) ? tags : [];
  return (
    list.find((tag) => tag && tag.type === 'tag' && normalizeTagName(tag.name) === target) ?? null
  );
}

/**
 * 判定输入框回车时应执行的动作：
 * - `empty`：空输入（含全空白）—— 什么都不做，避免创建一个空标签；
 * - `select`：命中已有标签 —— 直接选中，不产生任何写请求；
 * - `create`：未命中且**有** `taxonomy.manage` —— 创建后选中；
 * - `forbidden`：未命中且**无**该权限 —— 只提示、不创建（用户已定口径）。
 */
export function decideTagAction({ text, tags, canCreate }) {
  if (!normalizeTagName(text)) return 'empty';
  if (findExistingTag(tags, text)) return 'select';
  return canCreate ? 'create' : 'forbidden';
}

/**
 * 错误是否为"重名 409"。
 *
 * 服务端建词条只按 **slug** 判重（见 `taxonomy/src/index.ts` 的 save），因此本地
 * 按名称查重可能漏判（名称不同、slug 归一化后却相同）。这种情况必须回退到
 * "选中已有那个"，而不是把 409 当失败弹给用户。
 */
export function isDuplicateTermError(error) {
  return Boolean(error) && error.status === 409;
}
