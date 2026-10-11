<script setup lang="ts">
/**
 * 空状态：图标 + 标题 + 说明 + 可选操作。
 *
 * 图标传 lucide 组件（Core 页面）或使用默认占位；插件零构建时可省略图标。
 */
defineProps<{
  title: string;
  description?: string;
  /** 传入 lucide 图标组件；不传则只显示文字。 */
  icon?: unknown;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card px-6 py-12 text-center">
    <component :is="icon" v-if="icon" class="h-6 w-6 text-muted-foreground" />
    <p class="mt-2 text-sm text-foreground">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-3 flex items-center gap-2">
      <slot />
    </div>
  </div>
</template>
