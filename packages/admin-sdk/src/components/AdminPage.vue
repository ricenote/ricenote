<script setup lang="ts">
/**
 * 后台页面骨架：标题区（标题 / 说明 / 操作按钮）+ 内容区。
 *
 * 宿主只提供外壳（侧栏、顶栏）；页面自身的一致性由这个组件保证：
 * 标题字号、间距、操作区对齐方式在 Core 页面与插件页面之间完全一致。
 */
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-xs text-muted-foreground">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>

    <div v-if="$slots.toolbar" class="rounded-lg border border-border bg-card p-4">
      <slot name="toolbar" />
    </div>

    <slot />
  </div>
</template>
