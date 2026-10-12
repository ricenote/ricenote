<script setup lang="ts">
/**
 * 内容自定义字段渲染器：把主题声明的字段集渲染成表单控件。
 *
 * 文章与页面编辑页共用这一个组件（声明来自 `GET /api/admin/content-fields`），
 * 因此"字段长什么样、怎么回填"只有一份实现。
 *
 * 两条刻意的边界：
 * 1. **不做客户端合法性裁判**：只把声明里的约束（`maxLength` / `min` / `max`）
 *    透传给输入控件，真正的裁判是服务端 `assertContentFieldValues`；
 *    前端再判一遍只会与它漂移（还会出现"前端拦了、服务端其实接受"这类假故障）。
 * 2. **无声明时什么都不渲染**：编辑页据此整块隐藏字段区，不必自己判断有无字段。
 *
 * 取声明默认自带（见 `useContentFields`），也接受 `fields` prop 覆盖。
 */
import { computed, reactive } from 'vue';
import type { ContentFieldDto } from '@ricenote/shared';
import { cn } from '../utils.js';
import { useContentFields } from './use-content-fields.js';
import Button from '../components/ui/Button.vue';
import Field from '../components/Field.vue';
import Icon from '../components/Icon.vue';
import Input from '../components/ui/Input.vue';
import Select from '../components/ui/Select.vue';
import Switch from '../components/ui/Switch.vue';
import Textarea from '../components/ui/Textarea.vue';

const props = withDefaults(
  defineProps<{
    /** 覆盖内置取数（便于预览/测试/宿主统一下发）；缺省时用 SDK 自取的主题声明。 */
    fields?: ContentFieldDto[];
    /** 值对象；形状与 `PostSaveRequest.fields` 一致。 */
    modelValue: Record<string, unknown>;
    disabled?: boolean;
  }>(),
  { disabled: false }
);

const emit = defineEmits<{ (event: 'update:modelValue', value: Record<string, unknown>): void }>();

const store = useContentFields();
/** 生效声明：prop 优先，否则用自取的声明。 */
const declared = computed(() => props.fields ?? store.fields);

/* ------------------------------ 值读写 ------------------------------ */

function valueOf(key: string): unknown {
  return props.modelValue?.[key];
}

function stringOf(key: string): string {
  const value = valueOf(key);
  if (typeof value === 'string') return value;
  return value === undefined || value === null ? '' : String(value);
}

function numberStringOf(key: string): string {
  const value = valueOf(key);
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function listOf(key: string): string[] {
  const value = valueOf(key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 不可变写回：整体替换 modelValue，宿主侧 watch/computed 才会正确触发。 */
function setValue(key: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function setString(key: string, value: string): void {
  setValue(key, value);
  // 值变了就重置破图状态，否则改好链接后缩略图仍停在占位
  if (previewFailed[key]) previewFailed[key] = false;
}

function setNumber(key: string, raw: string): void {
  if (raw.trim() === '') {
    setValue(key, undefined);
    return;
  }
  const parsed = Number(raw);
  // 非法数字原样保留交给服务端裁判，不在前端吞掉用户输入
  setValue(key, Number.isFinite(parsed) ? parsed : raw);
}

/* --------------------------- 图片/链接预览 --------------------------- */

const previewFailed = reactive<Record<string, boolean>>({});

function previewSrc(key: string): string {
  if (previewFailed[key]) return '';
  return stringOf(key).trim();
}

/* ---------------------------- 字符串列表 ---------------------------- */

const drafts = reactive<Record<string, string>>({});

function draftOf(key: string): string {
  return drafts[key] ?? '';
}

function pushItem(key: string): void {
  const text = draftOf(key).trim();
  if (text.length === 0) return;
  setValue(key, [...listOf(key), text]);
  drafts[key] = '';
}

function removeItem(key: string, index: number): void {
  setValue(
    key,
    listOf(key).filter((_, position) => position !== index)
  );
}

const chipClasses = cn(
  'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground'
);
</script>

<template>
  <div v-if="declared.length > 0" class="flex flex-col gap-4">
    <Field
      v-for="field in declared"
      :key="field.key"
      :label="field.label"
      :description="field.description"
    >
      <!-- 布尔 -->
      <Switch
        v-if="field.type === 'boolean'"
        :model-value="valueOf(field.key) === true"
        :disabled="props.disabled"
        @update:model-value="setValue(field.key, $event)"
      />

      <!-- 数字：min/max 只透传给控件 -->
      <Input
        v-else-if="field.type === 'number'"
        type="number"
        :model-value="numberStringOf(field.key)"
        :placeholder="field.placeholder"
        :min="field.min"
        :max="field.max"
        :disabled="props.disabled"
        @update:model-value="setNumber(field.key, $event)"
      />

      <!-- 多行文本 -->
      <Textarea
        v-else-if="field.type === 'textarea'"
        :model-value="stringOf(field.key)"
        :placeholder="field.placeholder"
        :disabled="props.disabled"
        @update:model-value="setString(field.key, $event)"
      />

      <!-- 下拉：直接用声明里的 options -->
      <Select
        v-else-if="field.type === 'select'"
        :model-value="stringOf(field.key)"
        :options="field.options ?? []"
        :disabled="props.disabled"
        @update:model-value="setString(field.key, $event)"
      />

      <!-- 字符串列表：内联胶囊增删 -->
      <div v-else-if="field.type === 'stringList'" class="flex flex-col gap-2">
        <div v-if="listOf(field.key).length > 0" class="flex flex-wrap gap-1.5">
          <span v-for="(item, index) in listOf(field.key)" :key="`${item}-${index}`" :class="chipClasses">
            {{ item }}
            <button
              type="button"
              class="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              :disabled="props.disabled"
              aria-label="移除该项"
              @click="removeItem(field.key, index)"
            >
              <Icon name="x" class="h-3 w-3" />
            </button>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <Input
            :model-value="draftOf(field.key)"
            :placeholder="field.placeholder ?? '输入后回车添加'"
            :maxlength="field.maxLength"
            :disabled="props.disabled"
            class="flex-1"
            @update:model-value="drafts[field.key] = $event"
            @enter="pushItem(field.key)"
          />
          <Button size="sm" variant="outline" :disabled="props.disabled" @click="pushItem(field.key)">
            添加
          </Button>
        </div>
        <p v-if="field.maxItems !== undefined" class="text-[11px] text-muted-foreground">
          最多 {{ field.maxItems }} 项
        </p>
      </div>

      <!-- 颜色：色块 + 文本 -->
      <div v-else-if="field.type === 'color'" class="flex items-center gap-2">
        <span
          class="h-9 w-9 shrink-0 rounded-md border border-border"
          :style="{ backgroundColor: stringOf(field.key) || 'transparent' }"
          aria-hidden="true"
        />
        <Input
          :model-value="stringOf(field.key)"
          placeholder="#RRGGBB"
          :maxlength="field.maxLength"
          :disabled="props.disabled"
          class="flex-1"
          @update:model-value="setString(field.key, $event)"
        />
      </div>

      <!-- 图片 / 链接：单行输入 + 右侧缩略图；破图时退回占位，不撑破布局 -->
      <div v-else-if="field.type === 'image' || field.type === 'url'" class="flex items-center gap-2">
        <Input
          :model-value="stringOf(field.key)"
          :placeholder="field.placeholder"
          :maxlength="field.maxLength"
          :disabled="props.disabled"
          class="flex-1"
          @update:model-value="setString(field.key, $event)"
        />
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40"
          :title="previewFailed[field.key] ? '图片链接无效，已退回占位（仅保存链接本身）' : undefined"
        >
          <img
            v-if="previewSrc(field.key)"
            :src="previewSrc(field.key)"
            alt=""
            class="h-full w-full object-cover"
            @error="previewFailed[field.key] = true"
          />
          <Icon v-else name="image" class="h-4 w-4 text-muted-foreground" />
        </span>
      </div>

      <!-- 其余（text / 未知类型）按单行文本处理 -->
      <Input
        v-else
        :model-value="stringOf(field.key)"
        :placeholder="field.placeholder"
        :maxlength="field.maxLength"
        :disabled="props.disabled"
        @update:model-value="setString(field.key, $event)"
      />
    </Field>
  </div>
</template>
