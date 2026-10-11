<script setup lang="ts">
import { computed } from 'vue';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-vue-next';
import { cn } from '@/lib/utils';

/**
 * shadcn 风格的按钮。
 * 注意：主按钮使用浅黄底 + 深色前景（保证对比度），并且不携带任何阴影类。
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        outline: 'border border-border bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90'
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
  }>(),
  {
    variant: 'default',
    size: 'default',
    type: 'button',
    disabled: false,
    loading: false
  }
);

const classes = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size })));
const isDisabled = computed(() => props.disabled || props.loading);
</script>

<template>
  <button :type="props.type" :class="classes" :disabled="isDisabled" :aria-busy="props.loading">
    <Loader2 v-if="props.loading" class="h-4 w-4 animate-spin" />
    <slot />
  </button>
</template>
