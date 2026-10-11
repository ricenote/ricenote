<script setup lang="ts">
/**
 * 插件后台界面的**通用宿主**。
 *
 * 这个组件与任何具体插件无关：它只做四件事 ——
 * 1. 按菜单下发的 `entryUrl` 动态 `import()` 插件模块；
 * 2. 加载/出错/未启用三类状态给出可操作的提示（不让整个后台白屏）；
 * 3. 用 `onErrorCaptured` 兜住插件运行期异常，只降级当前页面；
 * 4. 注入插件自带的 `style.css`（若存在），卸载时移除。
 *
 * 因此 Core 里不再出现任何"插件专属页面文件"，插件停用即界面消失。
 */

import { computed, onBeforeUnmount, onErrorCaptured, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Card, LoadingState, navigate } from '@ricenote/admin-sdk';
import { useAdminMenu } from '@/stores/menu';

type HostStatus = 'loading' | 'ready' | 'error' | 'unavailable';

interface EntryTarget {
  label: string;
  pluginId: string;
  entryUrl: string;
  /** 插件自带样式（清单声明 `style` 时由 Core 下发）。 */
  styleUrl?: string;
  available: boolean;
}

const route = useRoute();
const menu = useAdminMenu();

const status = ref<HostStatus>('loading');
const detail = ref('');
const page = shallowRef<unknown>(null);

/** 已注入的插件样式表（按 URL 去重，卸载时移除）。 */
const injectedStyles = new Map<string, HTMLStyleElement>();
let attempt = 0;

/** 当前路径对应的插件入口：优先路由 meta，其次按路径回查菜单（深链更稳）。 */
const target = computed<EntryTarget | undefined>(() => {
  const meta = route.meta as {
    title?: string;
    pluginId?: string;
    entryUrl?: string;
    styleUrl?: string;
  };

  if (meta.entryUrl) {
    return {
      label: meta.title ?? route.path,
      pluginId: meta.pluginId ?? '',
      entryUrl: meta.entryUrl,
      ...(meta.styleUrl ? { styleUrl: meta.styleUrl } : {}),
      available: true
    };
  }

  const item = menu.findByPath(route.path);
  if (!item?.entryUrl) return undefined;
  return {
    label: item.label,
    pluginId: item.pluginId ?? '',
    entryUrl: item.entryUrl,
    ...(item.styleUrl ? { styleUrl: item.styleUrl } : {}),
    available: item.available !== false
  };
});

/**
 * 注入插件自带样式。
 *
 * 只在**清单声明了 `style`** 时调用（Core 会校验文件存在再下发 URL）——
 * 不去"探测"style.css 是否存在：那会在控制台留下一串 404，看起来像故障。
 */
async function ensureStyle(styleUrl: string): Promise<void> {
  if (injectedStyles.has(styleUrl)) return;

  try {
    const response = await fetch(styleUrl, { headers: { Accept: 'text/css' } });
    if (!response.ok) return;
    const css = await response.text();
    if (css.trim().length === 0) return;

    const element = document.createElement('style');
    element.textContent = css;
    element.dataset.pluginStyle = styleUrl;
    document.head.appendChild(element);
    injectedStyles.set(styleUrl, element);
  } catch {
    // 样式可选：取不到就只靠 SDK 组件与设计令牌，不打断界面加载
  }
}

function removeStyle(entryUrl: string): void {
  const element = injectedStyles.get(entryUrl);
  if (!element) return;
  element.remove();
  injectedStyles.delete(entryUrl);
}

/** 加载插件模块并把 `default` 导出挂到宿主里。 */
async function mount(current: EntryTarget): Promise<void> {
  if (!current.available) {
    page.value = null;
    status.value = 'unavailable';
    return;
  }

  status.value = 'loading';
  detail.value = '';
  attempt += 1;
  // 重试时加查询串：模块加载失败会被浏览器的模块表缓存，否则"重试"没有意义
  const url = attempt === 1 ? current.entryUrl : `${current.entryUrl}?retry=${attempt}`;

  try {
    const imported = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    if (!imported.default || typeof imported.default !== 'object') {
      status.value = 'error';
      detail.value = '模块没有导出默认组件（应使用 defineAdminPage 导出页面定义）';
      return;
    }

    page.value = imported.default;
    status.value = 'ready';
    if (current.styleUrl) void ensureStyle(current.styleUrl);
  } catch (error) {
    status.value = 'error';
    detail.value = error instanceof Error ? error.message : String(error);
  }
}

onErrorCaptured((error) => {
  const current = target.value;
  status.value = 'error';
  detail.value = error instanceof Error ? error.message : String(error);
  if (current) {
    console.error(`[plugin-admin] 插件 ${current.pluginId} 的界面渲染出错`, error);
  }
  // 阻止继续向上冒泡：插件出错只降级当前页面，不影响后台其余部分
  return false;
});

/*
 * 监听"入口 + 样式"的组合键（而不是整个 target 对象）：
 * target 每次求值都会产生新对象，直接 watch 它会在无关状态变化时重复卸载重挂。
 */
watch(
  () => `${target.value?.entryUrl ?? ''}|${target.value?.styleUrl ?? ''}`,
  (_key, previousKey) => {
    const previousStyle = previousKey?.split('|')[1];
    if (previousStyle && previousStyle !== (target.value?.styleUrl ?? '')) {
      removeStyle(previousStyle);
    }

    page.value = null;
    const current = target.value;
    if (!current) {
      status.value = 'error';
      detail.value = '该地址没有对应的插件界面声明';
      return;
    }
    void mount(current);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const [url] of injectedStyles) removeStyle(url);
});

function retry(): void {
  const current = target.value;
  if (current) void mount(current);
}

function goPlugins(): void {
  navigate('/plugins');
}

const errorSummary = computed(() => detail.value.split('\n')[0] ?? '');
</script>

<template>
  <LoadingState
    v-if="status === 'loading'"
    :message="`正在加载「${target?.label ?? '插件界面'}」…`"
  />

  <Card v-else-if="status === 'unavailable'" class="mx-auto mt-10 max-w-xl p-6">
    <h2 class="text-base font-semibold text-foreground">
      「{{ target?.label ?? route.path }}」由插件提供，当前未启用
    </h2>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      该页面属于插件 <code class="font-mono">{{ target?.pluginId || '（未知）' }}</code>，
      插件被停用或启动失败时其界面不可用（数据仍然保留在库中）。
      可在扩展中心启用该插件，然后按提示重启服务。
    </p>
    <div class="mt-4 flex items-center gap-2">
      <Button @click="goPlugins">去扩展中心</Button>
    </div>
  </Card>

  <Card v-else-if="status === 'error'" class="mx-auto mt-10 max-w-xl p-6">
    <h2 class="text-base font-semibold text-foreground">插件界面加载失败</h2>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      可能原因：插件尚未构建、界面文件缺失，或模块格式不正确。
      若刚更新过插件，请确认服务端已重启。
    </p>
    <p v-if="errorSummary" class="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
      {{ errorSummary }}
    </p>
    <div class="mt-4 flex items-center gap-2">
      <Button @click="retry">重试</Button>
      <Button variant="outline" @click="goPlugins">查看扩展中心</Button>
    </div>
  </Card>

  <component :is="page" v-else-if="status === 'ready'" />
</template>
