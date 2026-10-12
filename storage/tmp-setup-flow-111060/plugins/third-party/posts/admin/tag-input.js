/**
 * 标签输入框（零构建 UI 组件，**自己不发任何请求**）。
 *
 * 组件只负责"选 / 输 + 候选过滤 + 键盘交互"，所有副作用（查重、创建、提示、
 * 409 回退）都经回调 props 交给 editor.js —— 这样这里能保持纯 UI。
 *
 * 说明：`defineAdminContribution` 只支持 `name / props / setup / template`，
 * **没有 `emits`**，所以不走 `v-model` / `emit`，改用回调 props：
 * - `onToggle(id)`：选中 / 取消选中一个已有标签（父级负责去重）；
 * - `onSubmit(text)`：提交自由文本，返回 `Promise<boolean>`（true = 已消费，清空输入）。
 * 候选下拉是自己实现的（相对定位容器 + 绝对定位列表）：SDK 没有 Combobox/Popover。
 */

import {
  computed,
  defineAdminContribution,
  onBeforeUnmount,
  onMounted,
  ref
} from '/admin-sdk/v1/ricenote-admin.js';
import { findExistingTag, normalizeTagName } from './tag-utils.js';

export default defineAdminContribution({
  name: '标签输入',

  props: ['tagIds', 'tags', 'canCreate', 'onToggle', 'onSubmit'],

  setup(props) {
    const root = ref(null);
    const draft = ref('');
    const open = ref(false);
    /** 键盘高亮下标；-1 表示"没有高亮项"（此时回车走自由文本提交）。 */
    const activeIndex = ref(-1);

    const selectedTags = computed(() =>
      (props.tags ?? []).filter((tag) => (props.tagIds ?? []).includes(tag.id))
    );

    /** 候选：排除已选，按输入过滤（忽略大小写与首尾空白，与查重口径一致）。 */
    const candidates = computed(() => {
      const query = normalizeTagName(draft.value);
      return (props.tags ?? []).filter(
        (tag) =>
          !(props.tagIds ?? []).includes(tag.id) &&
          (query === '' || normalizeTagName(tag.name).includes(query))
      );
    });

    const exactMatch = computed(() => findExistingTag(props.tags, draft.value));
    /** 是否显示"创建 xxx"行：无权限时不显示 —— 界面就不该出现点不动的入口。 */
    const showCreate = computed(
      () => Boolean(props.canCreate) && draft.value.trim() !== '' && !exactMatch.value
    );
    const optionCount = computed(() => candidates.value.length + (showCreate.value ? 1 : 0));
    /** 无权限且未命中：给一行明确提示，而不是让回车"静默无反应"。 */
    const forbiddenHint = computed(
      () => draft.value.trim() !== '' && !exactMatch.value && !props.canCreate
    );

    /** 把名称按匹配片段切开，供模板高亮（匹配段用主色加粗）。 */
    function highlight(name) {
      const text = String(name ?? '');
      const query = normalizeTagName(draft.value);
      const index = query ? text.toLowerCase().indexOf(query) : -1;
      if (index < 0) return [{ text, match: false }];
      return [
        { text: text.slice(0, index), match: false },
        { text: text.slice(index, index + query.length), match: true },
        { text: text.slice(index + query.length), match: false }
      ].filter((part) => part.text !== '');
    }

    function onInput(value) {
      draft.value = value;
      open.value = true;
      activeIndex.value = -1;
    }

    function move(delta) {
      if (optionCount.value === 0) return;
      open.value = true;
      if (activeIndex.value < 0) activeIndex.value = delta > 0 ? 0 : optionCount.value - 1;
      else activeIndex.value = (activeIndex.value + delta + optionCount.value) % optionCount.value;
    }

    /** 选中 / 反选一个标签；清空输入并收起候选，避免"选完还留着旧搜索词"。 */
    function pick(tagId) {
      draft.value = '';
      open.value = false;
      activeIndex.value = -1;
      props.onToggle?.(tagId);
    }

    async function submit() {
      const text = draft.value.trim();
      if (text === '') {
        // 空输入不触发任何动作（decideTagAction 也判 empty，这里省一次回调）。
        open.value = false;
        return;
      }
      const consumed = await props.onSubmit?.(text);
      if (consumed) {
        draft.value = '';
        open.value = false;
        activeIndex.value = -1;
      }
    }

    function onEnter() {
      const candidate = activeIndex.value >= 0 ? candidates.value[activeIndex.value] : undefined;
      // 命中已有（exactMatch）时优先提交，让 editor 统一按 decideTagAction 处理；
      // 只有键盘高亮到某个候选时才直接选中，避免"打字打到一半被首个候选抢走"。
      if (!exactMatch.value && candidate) pick(candidate.id);
      else void submit();
    }

    function close() {
      open.value = false;
      activeIndex.value = -1;
    }

    /** 点击组件外部关闭：用 document 监听而非 blur，避免点候选项时先失焦后关闭。 */
    function onDocumentMouseDown(event) {
      if (root.value && !root.value.contains(event.target)) close();
    }

    onMounted(() => document.addEventListener('mousedown', onDocumentMouseDown));
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMouseDown));

    return {
      activeIndex,
      candidates,
      close,
      draft,
      forbiddenHint,
      highlight,
      move,
      onEnter,
      onInput,
      open,
      optionCount,
      pick,
      root,
      selectedTags,
      showCreate,
      submit
    };
  },

  template: `
<div ref="root" class="relative">
  <div v-if="selectedTags.length" class="flex flex-wrap gap-1.5">
    <span v-for="tag in selectedTags" :key="tag.id"
      class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
      {{ tag.name }}
      <button type="button" class="text-muted-foreground transition-colors hover:text-foreground"
        aria-label="移除标签" @click="pick(tag.id)">
        <Icon name="x" class="h-3 w-3" />
      </button>
    </span>
  </div>

  <Input class="mt-1.5" :model-value="draft" placeholder="选择或输入标签，回车添加"
    @update:model-value="onInput" @enter="onEnter" @focus="open = true"
    @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="close" />

  <ul v-if="open && optionCount > 0"
    class="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card py-1 text-sm">
    <li v-for="(tag, index) in candidates" :key="tag.id"
      :class="['flex cursor-pointer items-center px-3 py-1.5',
        index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60']"
      @mousedown.prevent="pick(tag.id)">
      <span class="truncate">
        <template v-for="(part, i) in highlight(tag.name)" :key="i">
          <span :class="part.match ? 'font-medium text-primary' : 'text-foreground'">{{ part.text }}</span>
        </template>
      </span>
    </li>
    <li v-if="showCreate"
      :class="['flex cursor-pointer items-center gap-1 px-3 py-1.5 text-foreground',
        candidates.length === activeIndex ? 'bg-muted' : 'hover:bg-muted/60']"
      @mousedown.prevent="submit()">
      <Icon name="plus" class="h-3.5 w-3.5" />
      创建标签「{{ draft.trim() }}」
    </li>
  </ul>

  <p v-if="forbiddenHint" class="mt-1 text-[11px] text-muted-foreground">
    没有创建标签的权限，请从候选里选择已有标签。
  </p>
</div>
`
});
