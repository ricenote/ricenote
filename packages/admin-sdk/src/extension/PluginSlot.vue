<script lang="ts">
/**
 * 模块级共享状态与工具（每个 Slot 实例共用一份）。
 *
 * 放在普通 `<script>` 块里是为了拿到**模块作用域**：样式引用计数表必须
 * 跨实例共享 —— 同一份插件样式可能被多个插槽引用，谁先卸载都不能误删别人的 <link>。
 */
import { defineAsyncComponent, defineComponent, onErrorCaptured, ref, type Component } from 'vue';

/** 样式引用计数：URL → { <link> 元素, 引用数 }。 */
const styleRefs = new Map<string, { el: HTMLLinkElement; count: number }>();

/** 引用一份贡献样式（首次引用才真正插入 <link>）。 */
function acquireStyle(url: string): void {
  const existing = styleRefs.get(url);
  if (existing) {
    existing.count += 1;
    return;
  }
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = url;
  // 打标记便于排查"这份样式是谁注入的"
  el.dataset.adminContributionStyle = url;
  document.head.appendChild(el);
  styleRefs.set(url, { el, count: 1 });
}

/** 释放一份贡献样式（引用归零才移除）。 */
function releaseStyle(url: string): void {
  const entry = styleRefs.get(url);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) {
    entry.el.remove();
    styleRefs.delete(url);
  }
}

/**
 * 惰性加载贡献模块，失败时追加 `?retry=N` 重试一次。
 *
 * 为什么要加查询串：模块加载失败会被浏览器的**模块表缓存**，用原 URL 重试不会
 * 真正重新发请求；换一个 URL 才可能拿到新结果。重试仍失败则抛出，
 * 由 async 组件降级为"渲染空"，不会拖垮整页。
 */
async function importContribution(url: string): Promise<Component> {
  const load = async (target: string): Promise<Component> => {
    const mod = (await import(/* @vite-ignore */ target)) as Component | { default?: Component };
    // 兼容"模块命名空间"与"直接导出组件"两种写法
    return (mod as { default?: Component }).default ?? (mod as Component);
  };

  try {
    return await load(url);
  } catch (error) {
    console.warn(`[admin-sdk] 扩展贡献加载失败，追加 retry 重试一次：${url}`, error);
    const retryUrl = `${url}${url.includes('?') ? '&' : '?'}retry=1`;
    return await load(retryUrl);
  }
}

/**
 * 单条贡献的错误边界：`onErrorCaptured` 返回 false 阻止冒泡，
 * 并把自身渲染为空 —— 单个贡献崩溃不影响默认内容与其它贡献，更不影响整页。
 */
const SlotBoundary = defineComponent({
  name: 'AdminSlotBoundary',
  setup(_props, { slots }) {
    const failed = ref(false);
    onErrorCaptured((error) => {
      if (!failed.value) {
        failed.value = true;
        console.warn('[admin-sdk] 扩展贡献渲染出错，已隔离该贡献', error);
      }
      return false;
    });
    return () => (failed.value ? null : (slots.default?.() ?? null));
  }
});
</script>

<script setup lang="ts">
/**
 * 后台插槽宿主：把内核下发的贡献渲染到"命名扩展点"上。
 *
 * 使用方（零构建插件模板）只需：
 *
 * ```html
 * <PluginSlot name="rice.posts.editorBody" :context="{ kind, value, onChange, onPreview }">
 *   默认文本域
 * </PluginSlot>
 * ```
 *
 * 锚点名（`rice.posts.*` / `rice.pages.*` 的 listActions / editorToolbar / editorBody）
 * 是**跨插件锁死的契约**，不要自创名字；`context` 的字段形状由提供方声明、
 * 贡献方在 `defineAdminContribution({ props: [...] })` 里对齐声明。
 *
 * 渲染规则（与内核裁决一致）：
 * - 无生效贡献 → 只渲染默认插槽；
 * - 有 append 无 replace → 默认内容 + 各贡献（order 降序）；
 * - 有 replace → 只渲染胜出贡献，**默认内容不渲染**。
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import type { AdminExtensionContributionDto } from '@ricenote/shared';
import { useAdminExtensions } from './use-extensions.js';

const props = defineProps<{
  /** 扩展点名（与 manifest 中声明的名字一致）。 */
  name: string;
  /** 传给贡献组件的 props（提供方声明的字段）。 */
  context?: Record<string, unknown>;
}>();

const extensions = useAdminExtensions();

/** 生效贡献（已含 replace 裁决与 order 降序）。 */
const effective = computed(() => extensions.effectiveFor(props.name));

/** 存在 replace 胜出：默认内容被整体替换，不渲染。 */
const replaced = computed(() => effective.value.some((item) => item.mode === 'replace'));

/** 贡献组件收到的 props，等价于 `h(component, context)`。 */
const contributionProps = computed(() => props.context ?? {});

/** 同一 entryUrl 复用同一个 async 组件，避免每次渲染重新创建。 */
const asyncCache = new Map<string, Component>();

function componentFor(item: AdminExtensionContributionDto): Component {
  let component = asyncCache.get(item.entryUrl);
  if (!component) {
    component = defineAsyncComponent({
      loader: () => importContribution(item.entryUrl),
      // 加载彻底失败时渲染空：可观测性交给 console.warn
      errorComponent: () => null
    });
    asyncCache.set(item.entryUrl, component);
  }
  return component;
}

/* ------------------------------ 样式注入 ------------------------------ */

/** 本组件当前持有的样式 URL（卸载时全部释放）。 */
const heldStyles = new Set<string>();

watch(
  () => effective.value.map((item) => item.styleUrl).filter((url): url is string => Boolean(url)),
  (urls) => {
    const next = new Set(urls);
    for (const url of next) if (!heldStyles.has(url)) acquireStyle(url);
    for (const url of heldStyles) if (!next.has(url)) releaseStyle(url);
    heldStyles.clear();
    for (const url of next) heldStyles.add(url);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const url of heldStyles) releaseStyle(url);
  heldStyles.clear();
});
</script>

<template>
  <!-- 默认插槽即"默认内容"：被 replace 时不渲染 -->
  <slot v-if="!replaced" />

  <!-- 每条贡献独立包在错误边界里：单条崩溃不影响其它内容与整页 -->
  <SlotBoundary v-for="item in effective" :key="`${item.pluginId}:${item.entryUrl}`">
    <component :is="componentFor(item)" v-bind="contributionProps" />
  </SlotBoundary>
</template>
