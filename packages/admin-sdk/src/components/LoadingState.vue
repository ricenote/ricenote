<script setup lang="ts">
/**
 * 加载态：细环指示器 + 一行次要说明。
 *
 * 用于宿主加载插件界面时的占位，也供页面在做全屏加载时复用；
 * 不做出骨架屏动画，避免与"无阴影、无毛玻璃"的克制风格冲突。
 */
withDefaults(
  defineProps<{
    message?: string;
    /** 是否为整页占位（撑开高度，避免布局跳动）。 */
    block?: boolean;
  }>(),
  { message: '正在加载…', block: true }
);
</script>

<template>
  <div
    :class="[
      'flex flex-col items-center justify-center gap-3 text-center',
      block ? 'min-h-[16rem] py-12' : 'py-6'
    ]"
  >
    <span
      class="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
      aria-hidden="true"
    />
    <p class="text-xs text-muted-foreground">{{ message }}</p>
  </div>
</template>
