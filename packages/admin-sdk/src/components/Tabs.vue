<script setup lang="ts">
/**
 * 分段式标签页：1px 边框 + 背景色差表达选中态（无阴影、无下划线动画以外的动效）。
 */
import { cn } from '../utils.js';

export interface TabItem {
  key: string;
  label: string;
  /** 可选计数徽标（如"待审核 3"）。 */
  badge?: string | number;
}

const props = defineProps<{
  modelValue: string;
  items: TabItem[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

function select(key: string): void {
  if (props.disabled || key === props.modelValue) return;
  emit('update:modelValue', key);
}
</script>

<template>
  <div class="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
    <button
      v-for="item in props.items"
      :key="item.key"
      type="button"
      :class="
        cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          item.key === props.modelValue
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )
      "
      :disabled="props.disabled"
      @click="select(item.key)"
    >
      {{ item.label }}
      <span v-if="item.badge !== undefined" class="text-[11px] text-muted-foreground">
        {{ item.badge }}
      </span>
    </button>
  </div>
</template>
