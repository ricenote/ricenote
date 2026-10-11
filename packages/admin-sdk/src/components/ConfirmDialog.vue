<script setup lang="ts">
/**
 * 二次确认对话框（危险操作、高风险提示共用）。
 *
 * 比 `window.confirm` 好在：文案可富文本、危险色可区分、可放"我已了解"类勾选项。
 */
import { ref, watch } from 'vue';
import Button from './ui/Button.vue';
import Dialog from './ui/Dialog.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 主按钮语气：危险操作用 destructive。 */
    tone?: 'default' | 'destructive';
    loading?: boolean;
    /** 需要用户显式勾选才能确认（高风险提示用）。 */
    requireAcknowledge?: boolean;
    acknowledgeLabel?: string;
  }>(),
  {
    confirmLabel: '确认',
    cancelLabel: '取消',
    tone: 'default',
    loading: false,
    requireAcknowledge: false,
    acknowledgeLabel: '我已了解并确认'
  }
);

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'confirm'): void;
}>();

const acknowledged = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) acknowledged.value = false;
  }
);
</script>

<template>
  <Dialog
    :open="props.open"
    :title="props.title"
    :description="props.message"
    width="sm"
    @update:open="emit('update:open', $event)"
  >
    <slot />

    <label
      v-if="props.requireAcknowledge"
      class="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5"
    >
      <input
        v-model="acknowledged"
        type="checkbox"
        class="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[hsl(var(--warning))]"
      />
      <span class="text-xs leading-relaxed text-foreground">{{ props.acknowledgeLabel }}</span>
    </label>

    <template #footer>
      <Button variant="ghost" @click="emit('update:open', false)">{{ props.cancelLabel }}</Button>
      <Button
        :variant="props.tone === 'destructive' ? 'destructive' : 'default'"
        :loading="props.loading"
        :disabled="props.requireAcknowledge && !acknowledged"
        @click="emit('confirm')"
      >
        {{ props.confirmLabel }}
      </Button>
    </template>
  </Dialog>
</template>
