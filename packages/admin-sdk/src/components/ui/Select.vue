<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { cn } from '../../utils.js';

export interface SelectOption {
  label: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    options: SelectOption[];
    disabled?: boolean;
    class?: string;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>();

const classes = computed(() =>
  cn(
    'h-9 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-sm text-foreground',
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-60',
    props.class
  )
);
</script>

<template>
  <div class="relative">
    <select
      :class="classes"
      :value="props.modelValue"
      :disabled="props.disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in props.options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <ChevronDown
      class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
</template>
