/**
 * 固定链接插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（AdminPage/Card/Button/Badge/Icon…）已由宿主全局注册，模板里直接写标签即可；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径仍是插件自己的管理 API。
 *
 * 页面**按接口返回的方案列表动态渲染**：第三方插件通过 `rice.permalink.schemes`
 * 贡献的方案会自动出现在这里，本文件不需要为它改一行代码。
 */

import {
  api,
  computed,
  defineAdminPage,
  nextTick,
  onMounted,
  reactive,
  ref,
  useSession,
  useSystemState,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

/** 预设之外的「个性化定义」选项值。 */
const CUSTOM = '__custom__';
const PREVIEW_DEBOUNCE_MS = 250;

function messageOf(error) {
  return error && error.message ? error.message : '操作失败，请稍后重试';
}

export default defineAdminPage({
  title: '固定链接',

  setup() {
    const session = useSession();
    const toast = useToast();
    const system = useSystemState();

    const canManage = computed(() => session.can('permalink.manage'));

    const schemes = ref([]);
    const loading = ref(false);
    const saving = ref(false);
    /** 每个方案的编辑状态与预览结果。 */
    const state = reactive({});

    /** 参数输入框元素（用于在光标处插入参数）与预览防抖计时器。 */
    const inputs = {};
    const timers = {};

    /** 未被后台显式配置过的方案，以默认模板作为"未改动"基线。 */
    function baselineOf(scheme) {
      return scheme.configured ? scheme.template : scheme.defaultTemplate;
    }

    function currentTemplate(scheme) {
      const entry = state[scheme.id];
      if (!entry) return scheme.defaultTemplate;
      return entry.selection === CUSTOM ? entry.custom : entry.selection;
    }

    const anyChanged = computed(() =>
      schemes.value.some((scheme) => currentTemplate(scheme) !== baselineOf(scheme))
    );

    function isCustom(scheme) {
      const entry = state[scheme.id];
      return !entry || entry.selection === CUSTOM;
    }

    function selectPreset(scheme, value) {
      const entry = state[scheme.id];
      if (!entry) return;

      if (value === CUSTOM) {
        // 从预设切到自定义时，用当前生效的模板作为编辑起点，避免输入框空着
        entry.custom = entry.selection === CUSTOM ? entry.custom : entry.selection;
        entry.selection = CUSTOM;
      } else {
        entry.selection = value;
      }
      schedulePreview(scheme);
    }

    function schedulePreview(scheme) {
      if (timers[scheme.id]) clearTimeout(timers[scheme.id]);
      timers[scheme.id] = setTimeout(() => {
        void runPreview(scheme);
      }, PREVIEW_DEBOUNCE_MS);
    }

    async function runPreview(scheme) {
      const entry = state[scheme.id];
      if (!entry) return;

      const template = currentTemplate(scheme);
      if (!template) {
        entry.preview = { valid: false, issues: [{ message: '请先填写路径' }] };
        return;
      }

      try {
        entry.preview = await api.post('/permalink/preview', { schemeId: scheme.id, template });
      } catch (error) {
        entry.preview = { valid: false, issues: [{ message: messageOf(error) }] };
      }
    }

    /** 在光标处插入参数，插入后把光标停在参数之后。 */
    function insertToken(scheme, token) {
      const entry = state[scheme.id];
      if (!entry || !canManage.value) return;
      if (entry.selection !== CUSTOM) selectPreset(scheme, CUSTOM);

      const snippet = `{${token.name}}`;
      const el = inputs[scheme.id];
      const current = entry.custom || '';

      if (!el) {
        entry.custom = `${current}${snippet}`;
        schedulePreview(scheme);
        return;
      }

      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? start;
      entry.custom = `${current.slice(0, start)}${snippet}${current.slice(end)}`;

      const caret = start + snippet.length;
      void nextTick(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
      schedulePreview(scheme);
    }

    async function load() {
      loading.value = true;
      try {
        const data = await api.get('/permalink/settings');
        schemes.value = data?.schemes ?? [];

        for (const key of Object.keys(state)) delete state[key];
        for (const scheme of schemes.value) {
          const baseline = baselineOf(scheme);
          const matched = (scheme.presets || []).some((preset) => preset.template === baseline);
          state[scheme.id] = {
            // 命中预设就选中该预设，否则进「个性化定义」并把当前模板填进输入框
            selection: matched ? baseline : CUSTOM,
            custom: matched ? '' : baseline,
            preview: null
          };
          void runPreview(scheme);
        }
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        loading.value = false;
      }
    }

    async function save() {
      if (!canManage.value) return;

      // 只提交与基线不同的方案：把某个方案改回默认时会删掉那一行，
      // 语义回到"未配置"（读取侧回落到方案默认模板）。
      const templates = {};
      for (const scheme of schemes.value) {
        const template = currentTemplate(scheme);
        if (template === baselineOf(scheme)) continue;
        templates[scheme.id] = template;
      }

      if (Object.keys(templates).length === 0) {
        toast.info('没有需要保存的改动');
        return;
      }

      saving.value = true;
      try {
        const data = await api.put('/permalink/settings', { templates });
        toast.success('已保存，重启后生效');
        // 顶栏据此立刻出现「待重启」入口（无需等待下一次状态轮询）
        system.markPending('固定链接设置已保存，重启后生效');
        await system.refresh();
        await load();
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        saving.value = false;
      }
    }

    onMounted(load);

    return {
      canManage,
      schemes,
      state,
      loading,
      saving,
      anyChanged,
      customOption: CUSTOM,
      isCustom,
      selectPreset,
      schedulePreview,
      insertToken,
      load,
      save,
      setInput: (id, el) => {
        if (el) inputs[id] = el;
        else delete inputs[id];
      }
    };
  },

  template: `
<AdminPage
  title="固定链接"
  description="为文章、独立页面与分类选择更友好的访问地址"
>
  <template #actions>
    <Button variant="outline" :loading="loading" @click="load">
      <Icon name="refresh" />
      刷新
    </Button>
    <Button v-if="canManage" :loading="saving" :disabled="!anyChanged" @click="save">
      <Icon name="save" />
      保存设置
    </Button>
  </template>

  <div class="flex items-start gap-2 rounded-md border border-primary bg-primary/10 px-3 py-2.5">
    <Icon name="alertcircle" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
    <p class="text-xs leading-relaxed text-foreground">
      一旦选定某种链接风格请不要轻易修改；修改后旧地址将不再可用。
      <span class="text-muted-foreground">保存后需重启服务生效。</span>
    </p>
  </div>

  <p v-if="!canManage" class="text-xs text-warning">当前账号没有修改权限，本页为只读。</p>

  <p v-if="loading && schemes.length === 0" class="py-6 text-center text-xs text-muted-foreground">
    正在加载…
  </p>

  <Card v-for="scheme in schemes" :key="scheme.id" class="p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-semibold text-foreground">{{ scheme.label }}</h2>
        <Badge variant="muted">{{ scheme.routeName }}</Badge>
        <Badge v-if="scheme.configured" variant="outline">已自定义</Badge>
      </div>
      <span class="font-mono text-[11px] text-muted-foreground">
        默认 {{ scheme.defaultTemplate }}
      </span>
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <button
        v-for="preset in scheme.presets || []"
        :key="preset.template"
        type="button"
        :disabled="!canManage"
        class="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-150"
        :class="state[scheme.id] && state[scheme.id].selection === preset.template
          ? 'border-primary border-l-2 bg-primary/15'
          : 'hover:bg-muted/40'"
        :style="{ cursor: canManage ? 'pointer' : 'not-allowed' }"
        @click="selectPreset(scheme, preset.template)"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="state[scheme.id] && state[scheme.id].selection === preset.template
            ? 'bg-primary'
            : 'bg-border'"
          aria-hidden="true"
        />
        <span class="w-40 shrink-0 text-xs text-foreground">{{ preset.label }}</span>
        <span class="font-mono text-[11px] text-muted-foreground">{{ preset.template }}</span>
      </button>

      <button
        type="button"
        :disabled="!canManage"
        class="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-150"
        :class="isCustom(scheme) ? 'border-primary border-l-2 bg-primary/15' : 'hover:bg-muted/40'"
        :style="{ cursor: canManage ? 'pointer' : 'not-allowed' }"
        @click="selectPreset(scheme, customOption)"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="isCustom(scheme) ? 'bg-primary' : 'bg-border'"
          aria-hidden="true"
        />
        <span class="text-xs text-foreground">个性化定义</span>
      </button>
    </div>

    <div v-if="isCustom(scheme)" class="mt-3 flex flex-col gap-2">
      <input
        :ref="(el) => setInput(scheme.id, el)"
        :value="state[scheme.id] ? state[scheme.id].custom : ''"
        :disabled="!canManage"
        :maxlength="200"
        spellcheck="false"
        placeholder="/{year}/{month}/{day}/{slug}"
        class="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70"
        @input="(event) => { state[scheme.id].custom = event.target.value; schedulePreview(scheme); }"
      />

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="token in scheme.tokens"
          :key="token.name"
          type="button"
          :disabled="!canManage"
          :title="token.description || token.label"
          class="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-foreground transition-colors duration-150 hover:bg-primary/20"
          :style="{ cursor: canManage ? 'pointer' : 'not-allowed' }"
          @click="insertToken(scheme, token)"
        >
          {{ '{' + token.name + '}' }}
        </button>
      </div>

      <p class="text-[11px] leading-relaxed text-muted-foreground">
        <template v-for="(token, index) in scheme.tokens" :key="token.name">
          <span v-if="index > 0"> · </span>
          <span class="font-mono text-foreground">{{ '{' + token.name + '}' }}</span>
          {{ token.label }}<span v-if="token.source" class="opacity-70">（{{ token.source }}）</span>
        </template>
      </p>
      <p class="text-[11px] text-muted-foreground">路径中至少需要包含一个参数。</p>
    </div>

    <div
      class="mt-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
      :class="state[scheme.id] && state[scheme.id].preview && state[scheme.id].preview.valid
        ? 'border-border bg-muted/40'
        : 'border-warning/50 bg-warning/5'"
    >
      <span class="text-[11px] font-medium text-muted-foreground">预览</span>
      <code
        v-if="state[scheme.id] && state[scheme.id].preview && state[scheme.id].preview.valid"
        class="font-mono text-xs text-foreground"
      >
        {{ state[scheme.id].preview.path }}
      </code>
      <span
        v-else-if="state[scheme.id] && state[scheme.id].preview"
        class="text-[11px] text-warning"
      >
        {{ (state[scheme.id].preview.issues || []).map((issue) => issue.message).join('；') }}
      </span>
      <span v-else class="text-[11px] text-muted-foreground">计算中…</span>
    </div>
  </Card>
</AdminPage>
`
});
