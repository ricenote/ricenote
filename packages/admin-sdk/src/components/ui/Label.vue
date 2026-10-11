<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../utils.js';

const props = withDefaults(
  defineProps<{ for?: string; required?: boolean; class?: string }>(),
  { required: false }
);

const classes = computed(() => cn('block text-sm font-medium text-foreground', props.class));
</script>

<template>
  <label :for="props.for" :class="classes">
    <slot />
    <span v-if="props.required" class="ml-0.5 text-destructive" aria-hidden="true">*</span>
  </label>
</template>
