<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../utils.js';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    maxlength?: number;
    min?: number;
    max?: number;
    autocomplete?: string;
    class?: string;
  }>(),
  { type: 'text', disabled: false, required: false }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'enter'): void;
}>();

const classes = computed(() =>
  cn(
    'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground',
    'placeholder:text-muted-foreground/70',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-60',
    props.class
  )
);

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    :class="classes"
    :type="props.type"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :required="props.required"
    :maxlength="props.maxlength"
    :min="props.min"
    :max="props.max"
    :autocomplete="props.autocomplete"
    @input="onInput"
    @keyup.enter="emit('enter')"
  />
</template>
