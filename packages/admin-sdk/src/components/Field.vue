<script setup lang="ts">
/**
 * 字段容器：标签 + 控件 + 说明 + 错误。
 *
 * 表单类页面的间距与提示位置统一由它决定，避免每个页面各写一套。
 */
import Label from './ui/Label.vue';

defineProps<{
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  /** 控件 id（关联 label 的 for）。 */
  for?: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="$props.for" :required="$props.required">{{ label }}</Label>
    <slot />
    <p v-if="$props.error" class="text-[11px] text-destructive">{{ $props.error }}</p>
    <p v-else-if="$props.description" class="text-[11px] text-muted-foreground">
      {{ $props.description }}
    </p>
  </div>
</template>
