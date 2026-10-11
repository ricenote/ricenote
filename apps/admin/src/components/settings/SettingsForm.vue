<script setup lang="ts">
/**
 * 声明式设置表单。
 *
 * 主题设置与插件设置使用**完全相同的结构**（分组 + 字段），
 * 因此共用这一套渲染实现：差异只在数据来源与保存端点，不在表单本身。
 *
 * 所有可本地化文案（label / description / placeholder / options[].label）
 * 已由服务端按站点语言解析为字符串，前端不再处理多语言。
 */
import type { SettingsFieldDto, SettingsGroupDto } from '@ricenote/shared';
import { Card, Input, Label, Select, Switch, Textarea } from '@ricenote/admin-sdk';

const props = defineProps<{
  groups: SettingsGroupDto[];
  values: Record<string, unknown>;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'update', key: string, value: unknown): void }>();

/** 取字段当前值：未设置时回落到声明默认值。 */
function valueOf(field: SettingsFieldDto): unknown {
  const current = props.values[field.key];
  return current === undefined || current === null ? (field.default ?? null) : current;
}

function set(key: string, value: unknown): void {
  emit('update', key, value);
}

function boolOf(field: SettingsFieldDto): boolean {
  const value = valueOf(field);
  return value === true || value === 'true';
}

/**
 * `stringList` 字段在表单里是「每行一项」的多行文本。
 *
 * 这里**刻意不做拆分**：输入过程中的空行必须原样保留，否则用户按回车换行时
 * 那个空行会立刻被抹掉，导致第二项根本敲不进去。拆分与归一化交给服务端
 * 校验器（它同时接受 `string[]` 与按行分隔的字符串），往返更稳。
 */
function listOf(field: SettingsFieldDto): string {
  const value = valueOf(field);
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n');
  return typeof value === 'string' ? value : '';
}
</script>

<template>
  <Card v-for="group in props.groups" :key="group.key" class="p-5">
    <h2 class="text-sm font-semibold text-foreground">{{ group.label }}</h2>
    <p v-if="group.description" class="mt-0.5 text-xs text-muted-foreground">
      {{ group.description }}
    </p>

    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <div v-for="field in group.fields" :key="field.key" class="flex flex-col gap-1.5">
        <Label>{{ field.label }}</Label>

        <Select
          v-if="field.type === 'select'"
          :model-value="String(valueOf(field) ?? '')"
          :options="field.options ?? []"
          :disabled="props.disabled"
          @update:model-value="(value: string) => set(field.key, value)"
        />

        <div v-else-if="field.type === 'boolean'" class="flex items-center gap-2.5 pt-0.5">
          <Switch
            :model-value="boolOf(field)"
            :disabled="props.disabled"
            @update:model-value="(value: boolean) => set(field.key, value)"
          />
          <span class="text-xs text-muted-foreground">
            {{ boolOf(field) ? '已开启' : '已关闭' }}
          </span>
        </div>

        <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
          <input
            type="color"
            class="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1"
            :value="String(valueOf(field) ?? '#000000')"
            :disabled="props.disabled"
            @input="set(field.key, ($event.target as HTMLInputElement).value)"
          />
          <Input
            class="flex-1 font-mono"
            :model-value="String(valueOf(field) ?? '')"
            :disabled="props.disabled"
            @update:model-value="(value: string) => set(field.key, value)"
          />
        </div>

        <Input
          v-else-if="field.type === 'number'"
          type="number"
          :min="field.min"
          :max="field.max"
          :disabled="props.disabled"
          :model-value="Number(valueOf(field) ?? 0)"
          @update:model-value="(value: string) => set(field.key, Number(value))"
        />

        <Textarea
          v-else-if="field.type === 'textarea'"
          :rows="3"
          :maxlength="field.maxLength"
          :disabled="props.disabled"
          :model-value="String(valueOf(field) ?? '')"
          @update:model-value="(value: string) => set(field.key, value)"
        />

        <Textarea
          v-else-if="field.type === 'stringList'"
          :rows="4"
          class="font-mono text-xs"
          :placeholder="field.placeholder"
          :disabled="props.disabled"
          :model-value="listOf(field)"
          @update:model-value="(value: string) => set(field.key, value)"
        />

        <Input
          v-else
          :type="field.type === 'url' ? 'url' : 'text'"
          :maxlength="field.maxLength"
          :placeholder="field.placeholder"
          :disabled="props.disabled"
          :model-value="String(valueOf(field) ?? '')"
          @update:model-value="(value: string) => set(field.key, value)"
        />

        <p v-if="field.type === 'stringList'" class="text-[11px] text-muted-foreground">
          每行一项，空行会被忽略。
        </p>

        <p v-if="field.description" class="text-[11px] text-muted-foreground">
          {{ field.description }}
        </p>
      </div>
    </div>
  </Card>
</template>
