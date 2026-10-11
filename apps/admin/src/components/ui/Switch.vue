<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{ modelValue?: boolean; disabled?: boolean; id?: string; class?: string }>(),
  { modelValue: false, disabled: false }
);

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const trackClasses = computed(() =>
  cn(
    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    props.disabled ? 'cursor-not-allowed opacity-60' : '',
    props.modelValue ? 'border-primary bg-primary' : 'border-border bg-muted',
    props.class
  )
);

const knobClasses = computed(() =>
  cn(
    'pointer-events-none block h-3.5 w-3.5 rounded-full bg-card transition-transform',
    props.modelValue ? 'translate-x-[18px] bg-primary-foreground' : 'translate-x-[3px]'
  )
);
</script>

<template>
  <button
    :id="props.id"
    type="button"
    role="switch"
    :aria-checked="props.modelValue"
    :disabled="props.disabled"
    :class="trackClasses"
    @click="emit('update:modelValue', !props.modelValue)"
  >
    <span :class="knobClasses" />
  </button>
</template>
