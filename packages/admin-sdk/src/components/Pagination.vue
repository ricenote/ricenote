<script setup lang="ts">
/**
 * 分页控件：上一页 / 页码 / 下一页 + 总数说明。
 *
 * 页码过多时折叠为"首尾 + 当前页附近"，避免把工具栏撑爆。
 */
import { computed } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { cn } from '../utils.js';

const props = withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    total: number;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ (event: 'update:page', value: number): void }>();

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))));

/** 折叠后的页码序列（最多 7 个位置，中间用 -1 表示省略号）。 */
const pages = computed<number[]>(() => {
  const count = pageCount.value;
  const current = Math.min(Math.max(1, props.page), count);
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const around = new Set<number>([1, count, current, current - 1, current + 1]);
  const sorted = [...around].filter((value) => value >= 1 && value <= count).sort((a, b) => a - b);

  const output: number[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous > 0 && value - previous > 1) output.push(-1);
    output.push(value);
    previous = value;
  }
  return output;
});

function go(target: number): void {
  const next = Math.min(Math.max(1, target), pageCount.value);
  if (props.disabled || next === props.page) return;
  emit('update:page', next);
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-[11px] text-muted-foreground">
      共 {{ total }} 条 · 第 {{ Math.min(props.page, pageCount) }} / {{ pageCount }} 页
    </p>

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="props.disabled || props.page <= 1"
        aria-label="上一页"
        @click="go(props.page - 1)"
      >
        <ChevronLeft class="h-3.5 w-3.5" />
      </button>

      <template v-for="(value, index) in pages" :key="`${value}-${index}`">
        <span v-if="value === -1" class="px-1 text-xs text-muted-foreground">…</span>
        <button
          v-else
          type="button"
          :class="
            cn(
              'inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-xs transition-colors',
              value === props.page
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            )
          "
          :disabled="props.disabled"
          @click="go(value)"
        >
          {{ value }}
        </button>
      </template>

      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="props.disabled || props.page >= pageCount"
        aria-label="下一页"
        @click="go(props.page + 1)"
      >
        <ChevronRight class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
