<script setup lang="ts">
/**
 * 页面管理。
 *
 * 页面与文章的区别：页面不参与分类/标签与列表归档，拥有独立地址 `/page/:slug`，
 * 常用于「关于」「联系方式」「隐私政策」这类固定内容。
 *
 * 模板下拉的可选项来自**当前主题声明**（`pageTemplates`）：
 * 主题没声明时只提供「跟随主题默认」，服务端也会拒绝未声明的模板键。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { FileStack, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next';
import type { PageDetail, PageSaveRequest, PageStatus, PageSummary, ThemeSummary } from '@ricenote/shared';
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

const items = ref<PageSummary[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const statusFilter = ref<PageStatus | 'all'>('all');
const keyword = ref('');

/** 当前主题声明的可选页面模板。 */
const templateOptions = ref<{ label: string; value: string }[]>([]);

const canManage = computed(() => auth.can('page.manage'));

const statusLabel: Record<PageStatus, string> = { published: '已发布', draft: '草稿' };
const statusTone: Record<PageStatus, 'success' | 'muted'> = { published: 'success', draft: 'muted' };

const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const form = reactive<PageSaveRequest & { template: string }>({
  title: '',
  slug: '',
  content: '',
  status: 'draft',
  template: '',
  sortOrder: 0,
  seoTitle: '',
  seoDescription: ''
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ pageSize: '50' });
    if (statusFilter.value !== 'all') query.set('status', statusFilter.value);
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
    const response = await api.list<PageSummary>(`/pages?${query.toString()}`);
    items.value = response.data;
    total.value = response.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '页面列表加载失败');
  } finally {
    loading.value = false;
  }
}

/** 读取当前激活主题声明的页面模板清单。 */
async function loadTemplates(): Promise<void> {
  try {
    const themes = await api.get<ThemeSummary[]>('/themes');
    const active = themes.find((theme) => theme.active);
    templateOptions.value = [
      { label: '跟随主题默认模板', value: '' },
      ...(active?.pageTemplates ?? []).map((item) => ({
        label: item.description ? `${item.label} —— ${item.description}` : item.label,
        value: item.key
      }))
    ];
  } catch {
    templateOptions.value = [{ label: '跟随主题默认模板', value: '' }];
  }
}

function resetForm(): void {
  editingId.value = null;
  form.title = '';
  form.slug = '';
  form.content = '';
  form.status = 'draft';
  form.template = '';
  form.sortOrder = 0;
  form.seoTitle = '';
  form.seoDescription = '';
}

function openCreate(): void {
  resetForm();
  dialogOpen.value = true;
}

async function openEdit(row: PageSummary): Promise<void> {
  try {
    const detail = await api.get<PageDetail>(`/pages/${row.id}`);
    editingId.value = detail.id;
    form.title = detail.title;
    form.slug = detail.slug;
    form.content = detail.content;
    form.status = detail.status;
    form.template = detail.template ?? '';
    form.sortOrder = detail.sortOrder;
    form.seoTitle = detail.seoTitle ?? '';
    form.seoDescription = detail.seoDescription ?? '';
    dialogOpen.value = true;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '页面详情加载失败');
  }
}

async function save(): Promise<void> {
  if (!form.title.trim()) {
    toast.error('页面标题不能为空');
    return;
  }

  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      ...(form.slug?.trim() ? { slug: form.slug.trim() } : {}),
      content: form.content,
      status: form.status,
      template: form.template || null,
      sortOrder: Number(form.sortOrder) || 0,
      ...(form.seoTitle ? { seoTitle: form.seoTitle } : {}),
      ...(form.seoDescription ? { seoDescription: form.seoDescription } : {})
    };

    if (editingId.value) {
      await api.put(`/pages/${editingId.value}`, payload);
      toast.success('页面已更新');
    } else {
      await api.post('/pages', payload);
      toast.success('页面已创建');
    }
    dialogOpen.value = false;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(row: PageSummary): Promise<void> {
  if (!window.confirm(`确定删除页面「${row.title}」？该操作不可撤销。`)) return;
  try {
    await api.delete(`/pages/${row.id}`);
    toast.success('页面已删除');
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

onMounted(async () => {
  await Promise.all([load(), loadTemplates()]);
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">页面</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          独立页面拥有自己的地址（/page/别名），可选择主题声明的页面模板；发布后自动出现在前台导航插槽中
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" :loading="loading" @click="load">
          <RefreshCw class="h-3.5 w-3.5" />
          刷新
        </Button>
        <Button v-if="canManage" @click="openCreate">
          <Plus class="h-3.5 w-3.5" />
          新建页面
        </Button>
      </div>
    </header>

    <Card class="p-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="w-40">
          <Select
            :model-value="statusFilter"
            :options="[
              { label: '全部状态', value: 'all' },
              { label: '已发布', value: 'published' },
              { label: '草稿', value: 'draft' }
            ]"
            @update:model-value="(value: string) => { statusFilter = value as PageStatus | 'all'; void load(); }"
          />
        </div>
        <div class="min-w-[12rem] flex-1">
          <Input
            v-model="keyword"
            placeholder="按标题或别名搜索"
            @keyup.enter="load"
          />
        </div>
        <Button variant="outline" @click="load">搜索</Button>
        <span class="ml-auto text-[11px] text-muted-foreground">共 {{ total }} 个页面</span>
      </div>
    </Card>

    <Card class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border">
            <tr>
              <th class="rn-th">标题</th>
              <th class="rn-th w-40 hidden md:table-cell">地址</th>
              <th class="rn-th w-36 hidden lg:table-cell">页面模板</th>
              <th class="rn-th w-24">状态</th>
              <th class="rn-th w-40 hidden lg:table-cell">更新时间</th>
              <th class="rn-th w-32">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="row in items" :key="row.id" class="transition-colors hover:bg-muted/40">
              <td class="rn-td">
                <p class="text-sm font-medium text-foreground">{{ row.title }}</p>
                <p v-if="row.seoDescription" class="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {{ row.seoDescription }}
                </p>
              </td>
              <td class="rn-td hidden md:table-cell">
                <a
                  class="font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  :href="`/page/${row.slug}`"
                  target="_blank"
                  rel="noopener"
                >
                  /page/{{ row.slug }}
                </a>
              </td>
              <td class="rn-td hidden text-xs text-muted-foreground lg:table-cell">
                {{ row.template || '主题默认' }}
              </td>
              <td class="rn-td">
                <Badge :variant="statusTone[row.status]">{{ statusLabel[row.status] }}</Badge>
              </td>
              <td class="rn-td hidden text-xs text-muted-foreground lg:table-cell">
                {{ formatDateTime(row.updatedAt) }}
              </td>
              <td class="rn-td">
                <div class="flex items-center gap-1">
                  <Button v-if="canManage" variant="ghost" size="sm" @click="openEdit(row)">
                    <Pencil class="h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button v-if="canManage" variant="ghost" size="sm" @click="remove(row)">
                    <Trash2 class="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td class="rn-td py-12 text-center" colspan="6">
                <FileStack class="mx-auto h-6 w-6 text-muted-foreground" />
                <p class="mt-2 text-sm text-foreground">还没有页面</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  用「新建页面」创建「关于本站」「联系方式」这类固定内容页面。
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <Dialog
      v-model:open="dialogOpen"
      :title="editingId ? '编辑页面' : '新建页面'"
      description="正文支持 Markdown；页面模板只影响版式，不改变内容。"
      width="lg"
    >
      <div class="flex flex-col gap-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label>标题</Label>
            <Input v-model="form.title" placeholder="关于本站" :maxlength="255" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>地址别名</Label>
            <Input v-model="form.slug" placeholder="留空则按标题自动生成" :maxlength="200" />
            <p class="text-[11px] text-muted-foreground">最终地址：/page/{{ form.slug || '（自动生成）' }}</p>
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-3">
          <div class="flex flex-col gap-1.5 md:col-span-2">
            <Label>页面模板</Label>
            <Select v-model="form.template" :options="templateOptions" />
            <p class="text-[11px] text-muted-foreground">
              可选项来自当前主题的 pageTemplates 声明；选择「跟随主题默认模板」时使用主题的 page 模板。
            </p>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>状态</Label>
            <Select
              v-model="form.status"
              :options="[
                { label: '草稿', value: 'draft' },
                { label: '已发布', value: 'published' }
              ]"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>正文（Markdown）</Label>
          <Textarea v-model="form.content" :rows="14" placeholder="# 标题&#10;&#10;在这里书写页面内容…" />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label>SEO 标题（可选）</Label>
            <Input v-model="form.seoTitle" :maxlength="255" placeholder="留空则使用页面标题" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>SEO 描述（可选）</Label>
            <Input v-model="form.seoDescription" :maxlength="500" placeholder="留空则自动截取正文" />
          </div>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="save">{{ editingId ? '保存修改' : '创建页面' }}</Button>
      </template>
    </Dialog>
  </div>
</template>
