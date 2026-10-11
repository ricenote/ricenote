<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '../../utils.js';

/** 卡片容器：实色 + 1px 边框，无投影（ADR-006 硬性约束）。 */
const props = withDefaults(
  defineProps<{ hoverable?: boolean; class?: string }>(),
  { hoverable: false }
);

const classes = computed(() =>
  cn(
    'rounded-lg border border-border bg-card text-card-foreground',
    props.hoverable ? 'transition-colors hover:border-muted-foreground/40 hover:bg-muted/40' : '',
    props.class
  )
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
