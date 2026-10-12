/**
 * 文章**独立编辑页**（零构建）。
 *
 * 路由：`/posts/editor`（新建）、`/posts/editor?id=<id>`（编辑），manifest 里的 `hidden`
 * 页面 —— 只注册路由、不进侧栏，深链与刷新都可用。正文区是两个命名扩展点
 * （`rice.posts.editorToolbar` / `rice.posts.editorBody`）的锚点：无贡献时回落到
 * 默认多行文本域，这就是回退契约。
 *
 * 「词条」区：分类沿用原药丸按钮，**标签改为可"输入即创建"的输入框**（UI 见
 * `tag-input.js`、纯逻辑见 `tag-utils.js`）；保存仍只提交 `form.termIds`。
 * 内容字段用共享组件 `ContentFields`，预览由本页提供（`preview()` → `POST /posts/preview`）。
 */

import {
  api,
  computed,
  defineAdminPage,
  onBeforeRouteLeave,
  onMounted,
  reactive,
  ref,
  useRoute,
  useRouter,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';
import { decideTagAction, findExistingTag, isDuplicateTermError } from './tag-utils.js';
import TagInput from './tag-input.js';

const STATUS_OPTIONS = [
  { label: '草稿', value: 'draft' },
  { label: '直接发布', value: 'published' },
  { label: '归档', value: 'archived' }
];

function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

// 表单快照：用于"有改动才拦截离开"的脏检查。
function snapshot(form, content, fields) {
  return JSON.stringify({
    title: form.title, slug: form.slug, excerpt: form.excerpt,
    status: form.status, termIds: form.termIds, content, fields
  });
}

export default defineAdminPage({
  title: '编辑文章',

  setup() {
    const route = useRoute();
    const router = useRouter();
    const toast = useToast();
    // taxonomy.manage 只有 administrator/editor 有；无该权限时标签只允许选已有、不创建。
    const session = useSession();

    const editingId = ref(null);
    const loading = ref(false);
    const saving = ref(false);
    const errorMsg = ref('');

    const content = ref('');
    const form = reactive({ title: '', slug: '', excerpt: '', status: 'draft', termIds: [] });
    // 内容字段值。`ContentFields` 的 v-model 是**整体不可变替换**，只有 ref 才能让
    // "模板绑定"与下面的脏检查闭包指向同一份最新值。
    const fields = ref({});
    const terms = ref([]);
    // 词条拆两半：分类沿用原有药丸按钮，标签交给输入框组件（见 tag-input.js）。
    const categories = computed(() => terms.value.filter((term) => term.type === 'category'));
    const tags = computed(() => terms.value.filter((term) => term.type === 'tag'));
    const confirmLeaveOpen = ref(false);

    const baseline = ref(snapshot(form, '', {}));
    const dirty = computed(() => snapshot(form, content.value, fields.value) !== baseline.value);
    const heading = computed(() => (editingId.value !== null ? '编辑文章' : '新建文章'));
    const canManageTags = computed(() => session.can('taxonomy.manage'));

    const setContent = (value) => { content.value = value; };

    /** 触发服务端预览：返回渲染并消毒后的 HTML（Promise<string>）。 */
    async function preview() {
      const result = await api.post('/posts/preview', { content: content.value });
      return result && result.html ? result.html : '';
    }

    async function loadTerms() {
      try {
        terms.value = await api.get('/terms');
      } catch {
        terms.value = [];
      }
    }

    async function loadPost() {
      if (editingId.value === null) return;
      loading.value = true;
      try {
        const detail = await api.get(`/posts/${editingId.value}`);
        form.title = detail.title;
        form.slug = detail.slug;
        form.excerpt = detail.excerpt;
        form.status = detail.status;
        form.termIds = detail.terms.map((term) => term.id);
        content.value = detail.content;
        // 详情里的 fields 已按当前主题声明过滤过，直接回填即可。
        fields.value = { ...(detail.fields || {}) };
      } catch (error) {
        errorMsg.value = messageOf(error, '文章加载失败');
      } finally {
        loading.value = false;
      }
    }

    function toggleTerm(termId) {
      const index = form.termIds.indexOf(termId);
      if (index >= 0) form.termIds.splice(index, 1);
      else form.termIds.push(termId);
    }
    const termClass = (termId) => (form.termIds.includes(termId)
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-card text-muted-foreground hover:bg-muted');
    // 只加不删：命中已有或创建成功后选中，重复选中不重复加入。
    const selectTag = (id) => { if (!form.termIds.includes(id)) form.termIds.push(id); };

    // 标签提交：命中已有则选中，未命中时有权限才创建；true 表示已被消费（子组件据此清空）。
    async function submitTag(text) {
      const action = decideTagAction({ text, tags: tags.value, canCreate: canManageTags.value });
      if (action === 'empty') return false;
      if (action === 'select') {
        selectTag(findExistingTag(tags.value, text).id);
        return true;
      }
      // 无权限：不创建（输入框组件自身会给一行"无权限"提示，避免弹两层重复文案）。
      if (action === 'forbidden') return false;
      const name = text.trim();
      try {
        const created = await api.post('/terms', { name, type: 'tag' });
        terms.value.push({ id: created.id, name, slug: '', type: 'tag', count: 0 });
        selectTag(created.id);
        return true;
      } catch (error) {
        if (!isDuplicateTermError(error)) {
          toast.error(messageOf(error, '标签创建失败'));
          return false;
        }
        // 服务端只按 slug 判重：本地按名称查重漏判时走这里 —— 重拉列表并选中同名那条。
        await loadTerms();
        const existing = findExistingTag(tags.value, name);
        if (existing) selectTag(existing.id);
        toast.success('该标签已存在，已选中');
        return true;
      }
    }

    function resetBaseline() {
      baseline.value = snapshot(form, content.value, fields.value);
    }

    async function save() {
      errorMsg.value = '';
      if (!form.title.trim()) {
        errorMsg.value = '标题不能为空';
        return;
      }
      saving.value = true;
      try {
        const payload = {
          title: form.title.trim(), slug: form.slug.trim() || undefined, content: content.value,
          excerpt: form.excerpt.trim(), status: form.status, termIds: [...form.termIds],
          // 编辑页管理字段，故显式提交（空对象表示清空）。
          fields: { ...fields.value }
        };
        if (editingId.value !== null) {
          await api.put(`/posts/${editingId.value}`, payload);
          toast.success('文章已更新');
        } else {
          await api.post('/posts', payload);
          toast.success(form.status === 'published' ? '文章已发布' : '草稿已保存');
        }
        resetBaseline();
        router.push('/posts');
      } catch (error) {
        errorMsg.value = messageOf(error, '保存失败');
      } finally {
        saving.value = false;
      }
    }

    function cancel() {
      router.push('/posts');
    }

    /* --------------------------- 未保存离开保护 --------------------------- */
    // 用既有确认对话框而非 window.confirm：样式统一、可键盘操作。
    let resolveLeave = null;
    onBeforeRouteLeave(() => {
      if (!dirty.value) return true;
      confirmLeaveOpen.value = true;
      return new Promise((resolve) => {
        resolveLeave = resolve;
      });
    });
    function confirmLeave() {
      confirmLeaveOpen.value = false;
      if (resolveLeave) {
        resolveLeave(true);
        resolveLeave = null;
      }
    }
    function cancelLeave() {
      confirmLeaveOpen.value = false;
      if (resolveLeave) {
        resolveLeave(false);
        resolveLeave = null;
      }
    }

    onMounted(async () => {
      const raw = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id;
      editingId.value = raw === undefined || raw === '' ? null : Number(raw);
      await loadTerms();
      await loadPost();
      resetBaseline();
    });

    return {
      cancel, cancelLeave, canManageTags, categories, confirmLeave, confirmLeaveOpen, content, dirty,
      editingId, errorMsg, fields, form, heading, loading, preview, save, saving, setContent,
      statusOptions: STATUS_OPTIONS, submitTag, tags, tagInput: TagInput, termClass, toggleTerm
    };
  },

  template: `
<AdminPage :title="heading"
  description="正文使用 Markdown，服务端渲染并统一消毒后再输出；预览与前台渲染结果一致。">
  <template #actions>
    <Button variant="ghost" @click="cancel">取消</Button>
    <Button :loading="saving" @click="save">{{ editingId !== null ? '保存' : '创建文章' }}</Button>
  </template>

  <p v-if="errorMsg" class="text-xs text-destructive">{{ errorMsg }}</p>

  <div class="flex flex-col gap-4 lg:flex-row">
    <div class="flex w-full flex-col gap-4 lg:w-[22rem] lg:shrink-0">
      <Card class="p-4">
        <div class="flex flex-col gap-4">
          <Field label="标题" required>
            <Input v-model="form.title" placeholder="例如：RiceNote 架构说明" /></Field>
          <Field label="别名（slug，留空自动生成）">
            <Input v-model="form.slug" placeholder="ricenote-architecture" /></Field>
          <Field label="状态"><Select v-model="form.status" :options="statusOptions" /></Field>
          <Field label="摘要（留空自动截取）">
            <Textarea v-model="form.excerpt" :rows="3" placeholder="用于列表与搜索结果的简短描述" /></Field>
          <div class="flex flex-col gap-1.5">
            <Label>分类</Label>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="term in categories" :key="term.id" type="button"
                :class="['rounded-full border px-2.5 py-1 text-xs transition-colors', termClass(term.id)]"
                @click="toggleTerm(term.id)">{{ term.name }}</button>
              <span v-if="!categories.length" class="text-xs text-muted-foreground">尚未创建分类，可前往「分类与标签」添加。</span>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>标签</Label>
            <!-- defineAdminPage 不透传 components，故用动态组件 :is 挂载本插件的输入框 -->
            <component :is="tagInput" :tag-ids="form.termIds" :tags="tags"
              :can-create="canManageTags" :on-toggle="toggleTerm" :on-submit="submitTag" />
          </div>
        </div>
      </Card>

      <!-- 主题声明的内容字段；无声明时组件自身不渲染任何内容 -->
      <ContentFields v-model="fields" :disabled="saving" />
    </div>

    <div class="flex min-h-[420px] flex-1 flex-col gap-2 lg:min-h-[calc(100vh-12rem)]">
      <PluginSlot name="rice.posts.editorToolbar"
        :context="{ kind: 'post', value: content, onChange: setContent, onPreview: preview }" />

      <PluginSlot name="rice.posts.editorBody"
        :context="{ kind: 'post', value: content, onChange: setContent, onPreview: preview }">
        <textarea
          class="h-full min-h-[420px] w-full flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          placeholder="# 标题&#10;&#10;支持常见 Markdown 语法…"
          v-model="content"></textarea>
      </PluginSlot>
    </div>
  </div>

  <ConfirmDialog :open="confirmLeaveOpen" title="放弃未保存的修改？"
    message="当前文章的修改尚未保存，离开将丢失这些改动。" tone="destructive"
    confirm-label="放弃并离开" cancel-label="继续编辑"
    @update:open="(value) => { if (!value) cancelLeave(); }" @confirm="confirmLeave" />
</AdminPage>
`
});
