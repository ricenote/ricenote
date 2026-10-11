<script setup lang="ts">
/**
 * 按名称渲染图标（受控子集，见 `icons.ts`）。
 *
 * 插件零构建时最实用：`<Icon name="plus" />` 即可，无需 import 任何 lucide 模块。
 */
import { computed } from 'vue';
import { resolveIcon } from '../icons.js';

const props = withDefaults(
  defineProps<{
    name: string;
    /** 尺寸类，默认小图标。 */
    class?: string;
  }>(),
  { class: 'h-3.5 w-3.5' }
);

const component = computed(() => resolveIcon(props.name));
</script>

<template>
  <component :is="component" :class="props.class" aria-hidden="true" />
</template>
