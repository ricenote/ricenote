<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-vue-next';
import { useToast, type ToastTone } from '../../composables/use-toast.js';

/**
 * 提示条容器。
 *
 * 由**宿主**挂载一次（后台 SPA 的 App.vue）；插件页面只调用 `useToast()`。
 * 固定在最外层，因此不会被插件自己的容器（overflow/裁剪）影响。
 */
const toast = useToast();

const toneClass: Record<ToastTone, string> = {
  success: 'border-success/40 bg-card text-foreground',
  error: 'border-destructive/40 bg-card text-foreground',
  warning: 'border-warning/40 bg-card text-foreground',
  info: 'border-border bg-card text-foreground'
};

const iconClass: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground'
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" role="status" aria-live="polite">
    <div
      v-for="item in toast.items"
      :key="item.id"
      :class="['pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 animate-slide-in-right', toneClass[item.tone]]"
    >
      <CheckCircle2 v-if="item.tone === 'success'" :class="['mt-0.5 h-4 w-4 shrink-0', iconClass.success]" />
      <AlertCircle v-else-if="item.tone === 'error'" :class="['mt-0.5 h-4 w-4 shrink-0', iconClass.error]" />
      <TriangleAlert v-else-if="item.tone === 'warning'" :class="['mt-0.5 h-4 w-4 shrink-0', iconClass.warning]" />
      <Info v-else :class="['mt-0.5 h-4 w-4 shrink-0', iconClass.info]" />

      <p class="flex-1 text-sm leading-relaxed">{{ item.message }}</p>

      <button
        type="button"
        class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="关闭提示"
        @click="toast.dismiss(item.id)"
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
