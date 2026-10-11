<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    class?: string;
  }>(),
  { rows: 6, disabled: false }
);

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

const classes = computed(() =>
  cn(
    'w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground',
    'placeholder:text-muted-foreground/70',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-60',
    props.class
  )
);

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <textarea
    :class="classes"
    :rows="props.rows"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    @input="onInput"
  />
</template>
