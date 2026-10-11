<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { X } from 'lucide-vue-next';

/**
 * 模态对话框：边框 + 背景色区分层级，无投影、无毛玻璃（ADR-006）。
 * 打开时锁定页面滚动，支持 Esc 关闭。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    description?: string;
    width?: 'sm' | 'md' | 'lg';
  }>(),
  { width: 'md' }
);

const emit = defineEmits<{ (event: 'update:open', value: boolean): void }>();

const widthClass: Record<string, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl'
};

function close(): void {
  emit('update:open', false);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    }
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <div v-if="props.open" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16">
    <div class="fixed inset-0 bg-foreground/40" aria-hidden="true" @click="close" />

    <div
      role="dialog"
      aria-modal="true"
      :class="['relative w-full rounded-lg border border-border bg-card animate-fade-in', widthClass[props.width]]"
    >
      <header class="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
        <div>
          <h2 class="text-base font-semibold text-foreground">{{ props.title }}</h2>
          <p v-if="props.description" class="mt-0.5 text-xs text-muted-foreground">
            {{ props.description }}
          </p>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="关闭"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
      </header>

      <div class="px-5 py-4">
        <slot />
      </div>

      <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
