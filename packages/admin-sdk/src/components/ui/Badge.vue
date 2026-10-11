<script setup lang="ts">
import { computed } from 'vue';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils.js';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground',
        outline: 'border-border bg-card text-muted-foreground',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        error: 'border-destructive/40 bg-destructive/10 text-destructive',
        muted: 'border-border bg-muted text-muted-foreground'
      }
    },
    defaultVariants: { variant: 'outline' }
  }
);

const props = withDefaults(defineProps<{ variant?: VariantProps<typeof badgeVariants>['variant'] }>(), {
  variant: 'outline'
});

const classes = computed(() => cn(badgeVariants({ variant: props.variant })));
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
