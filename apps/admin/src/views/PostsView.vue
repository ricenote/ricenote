<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Eye, Pencil, Plus, Search, Trash2 } from 'lucide-vue-next';
import type { PostDetail, PostStatus, PostSummary, TermSummary } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';
import Textarea from '@/components/ui/Textarea.vue';
import { formatDateTime } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();

const items = ref<PostSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const statusFilter = ref<'all' | PostStatus>('all');
const keyword = ref('');
const loading = ref(false);

const terms = ref<TermSummary[]>([]);

const editorOpen = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);

const form = reactive({
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  status: 'draft' as PostStatus,
  termIds: [] as number[]
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const canWrite = computed(() => auth.can('post.write'));
const canPublish = computed(() => auth.can('post.publish'));
const canDelete = computed(() => auth.can('post.delete'));

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已发布', value: 'published' },
  { label: '草稿', value: 'draft' },
  { label: '已归档', value: 'archived' }
];

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize),
      status: statusFilter.value
    });
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());

    const response = await api.list<PostSummary>(`/posts?${query.toString()}`);
    items.value = response.data;
    total.value = response.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '文章列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadTerms(): Promise<void> {
  try {
    terms.value = await api.get<TermSummary[]>('/terms');
  } catch {
    terms.value = [];
  }
}

function resetForm(): void {
  editingId.value = null;
  form.title = '';
  form.slug = '';
  form.content = '';
  form.excerpt = '';
  form.status = 'draft';
  form.termIds = [];
}

function openCreate(): void {
  resetForm();
  editorOpen.value = true;
}

async function openEdit(id: number): Promise<void> {
  try {
    const detail = await api.get<PostDetail>(`/posts/${id}`);
    editingId.value = detail.id;
    form.title = detail.title;
    form.slug = detail.slug;
    form.content = detail.content;
    form.excerpt = detail.excerpt;
    form.status = detail.status;
    form.termIds = detail.terms.map((term) => term.id);
    editorOpen.value = true;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '文章加载失败');
  }
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    toast.warning('标题不能为空');
    return;
  }

  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || undefined,
      content: form.content,
      excerpt: form.excerpt.trim(),
      status: form.status,
      termIds: form.termIds
    };

    if (editingId.value) {
      await api.put(`/posts/${editingId.value}`, payload);
      toast.success('文章已更新');
    } else {
      await api.post('/posts', payload);
      toast.success(form.status === 'published' ? '文章已发布' : '草稿已保存');
    }

    editorOpen.value = false;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(post: PostSummary): Promise<void> {
  if (!window.confirm(`确定删除《${post.title}》？该操作不可撤销。`)) return;
  try {
    await api.delete(`/posts/${post.id}`);
    toast.success('文章已删除');
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

function toggleTerm(termId: number): void {
  const index = form.termIds.indexOf(termId);
  if (index >= 0) form.termIds.splice(index, 1);
  else form.termIds.push(termId);
}

function goPage(next: number): void {
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  void load();
}

onMounted(async () => {
  await Promise.all([load(), loadTerms()]);
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">文章</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          共 {{ total }} 篇 · 内容由 posts 插件提供，启停该插件不影响后台其他功能
        </p>
      </div>
      <Button v-if="canWrite" @click="openCreate">
        <Plus class="h-4 w-4" />
        新建文章
      </Button>
    </header>

    <!-- 工具栏 -->
    <Card class="flex flex-wrap items-center gap-3 p-3.5">
      <div class="w-40">
        <Select v-model="statusFilter" :options="statusOptions" @update:model-value="() => { page = 1; load(); }" />
      </div>
      <div class="relative min-w-[14rem] flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="搜索标题或 slug" @enter="() => { page = 1; load(); }" />
      </div>
      <Button variant="outline" :loading="loading" @click="() => { page = 1; load(); }">查询</Button>
    </Card>

    <!-- 数据表 -->
    <Card class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border bg-muted/50">
            <tr>
              <th class="rn-th">标题</th>
              <th class="rn-th w-32">状态</th>
              <th class="rn-th w-40 hidden md:table-cell">词条</th>
              <th class="rn-th w-40 hidden lg:table-cell">更新时间</th>
              <th class="rn-th w-28 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="post in items" :key="post.id" class="transition-colors hover:bg-muted/40">
              <td class="rn-td">
                <p class="font-medium text-foreground">{{ post.title }}</p>
                <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">/post/{{ post.slug }}</p>
              </td>
              <td class="rn-td">
                <Badge :variant="post.status === 'published' ? 'success' : post.status === 'draft' ? 'muted' : 'outline'">
                  {{ post.status === 'published' ? '已发布' : post.status === 'draft' ? '草稿' : '已归档' }}
                </Badge>
              </td>
              <td class="rn-td hidden md:table-cell">
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="term in post.terms" :key="term.id" variant="outline">{{ term.name }}</Badge>
                  <span v-if="post.terms.length === 0" class="text-xs text-muted-foreground">—</span>
                </div>
              </td>
              <td class="rn-td hidden text-xs text-muted-foreground lg:table-cell">
                {{ formatDateTime(post.updatedAt) }}
              </td>
              <td class="rn-td">
                <div class="flex items-center justify-end gap-1">
                  <a
                    v-if="post.status === 'published'"
                    :href="`/post/${post.slug}`"
                    target="_blank"
                    rel="noopener"
                    class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="查看前台"
                  >
                    <Eye class="h-3.5 w-3.5" />
                  </a>
                  <button
                    v-if="canWrite"
                    type="button"
                    class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="编辑"
                    @click="openEdit(post.id)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    v-if="canDelete"
                    type="button"
                    class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    title="删除"
                    @click="remove(post)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && items.length === 0">
              <td class="rn-td py-10 text-center text-sm text-muted-foreground" colspan="5">
                暂无文章。点击右上角「新建文章」开始写作。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-border px-3.5 py-2.5">
        <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</Button>
          <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</Button>
        </div>
      </div>
    </Card>

    <!-- 编辑器 -->
    <Dialog
      v-model:open="editorOpen"
      :title="editingId ? '编辑文章' : '新建文章'"
      description="正文使用 Markdown，服务端渲染后统一消毒再输出。"
      width="lg"
    >
      <div class="flex flex-col gap-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label required>标题</Label>
            <Input v-model="form.title" placeholder="例如：RiceNote 架构说明" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>别名（slug，留空自动生成）</Label>
            <Input v-model="form.slug" placeholder="ricenote-architecture" />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label required>正文（Markdown）</Label>
          <Textarea v-model="form.content" :rows="12" placeholder="# 标题&#10;&#10;支持常见 Markdown 语法…" />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label>摘要（留空自动截取）</Label>
            <Textarea v-model="form.excerpt" :rows="3" placeholder="用于列表与搜索结果的简短描述" />
          </div>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <Label>状态</Label>
              <Select
                v-model="form.status"
                :options="[
                  { label: '草稿', value: 'draft' },
                  { label: canPublish ? '直接发布' : '发布（需 post.publish 权限）', value: 'published' },
                  { label: '归档', value: 'archived' }
                ]"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label>词条</Label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="term in terms"
                  :key="term.id"
                  type="button"
                  :class="[
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    form.termIds.includes(term.id)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted'
                  ]"
                  @click="toggleTerm(term.id)"
                >
                  {{ term.type === 'category' ? '分类' : '标签' }}：{{ term.name }}
                </button>
                <span v-if="terms.length === 0" class="text-xs text-muted-foreground">
                  尚未创建词条，可前往「分类与标签」添加。
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="editorOpen = false">取消</Button>
        <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '创建文章' }}</Button>
      </template>
    </Dialog>
  </div>
</template>
