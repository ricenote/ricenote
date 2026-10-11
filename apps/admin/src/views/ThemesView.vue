<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Check, ExternalLink, Eye, History, RotateCcw, Save } from 'lucide-vue-next';
import type { ThemeSettingsGroupDto, ThemeSummary } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import SettingsForm from '@/components/settings/SettingsForm.vue';
import { formatDateTime } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();

const themes = ref<ThemeSummary[]>([]);
const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);

const activeTab = ref<'installed' | 'settings'>('installed');
const selectedThemeId = ref<string | null>(null);
const revision = ref(0);
const values = reactive<Record<string, unknown>>({});
const history = ref<{ revision: number; createdAt: string }[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const canManage = computed(() => auth.can('theme.manage'));
const selectedTheme = computed(() => themes.value.find((item) => item.id === selectedThemeId.value) ?? null);
const groups = computed<ThemeSettingsGroupDto[]>(() => selectedTheme.value?.settingsGroups ?? []);

async function loadThemes(): Promise<void> {
  loading.value = true;
  try {
    themes.value = await api.get<ThemeSummary[]>('/themes');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '主题列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadSettings(themeId: string): Promise<void> {
  try {
    const result = await api.get<{ themeId: string; revision: number; values: Record<string, unknown> }>(
      `/themes/${themeId}/settings`
    );
    revision.value = result.revision;
    for (const key of Object.keys(values)) delete values[key];
    Object.assign(values, result.values);
    const items = await api.get<{ revision: number; createdAt: string }[]>(
      `/themes/${themeId}/settings/history`
    );
    history.value = items;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '主题设置加载失败');
  }
}

async function openSettings(theme: ThemeSummary): Promise<void> {
  selectedThemeId.value = theme.id;
  activeTab.value = 'settings';
  await loadSettings(theme.id);
}

async function activate(theme: ThemeSummary): Promise<void> {
  try {
    await api.post(`/themes/${theme.id}/activate`);
    toast.success(`已激活主题「${theme.name}」`);
    await loadThemes();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '激活失败');
  }
}

async function save(): Promise<void> {
  if (!selectedThemeId.value) return;
  saving.value = true;
  try {
    const result = await api.put<{ revision: number }>(`/themes/${selectedThemeId.value}/settings`, {
      values: { ...values },
      revision: revision.value
    });
    revision.value = result.revision;
    toast.success('设置已保存并发布');
    await Promise.all([loadThemes(), loadSettings(selectedThemeId.value)]);
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      toast.warning('设置已被其他会话修改，请重新加载后再保存');
      await loadSettings(selectedThemeId.value);
    } else {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

async function reset(): Promise<void> {
  if (!selectedThemeId.value) return;
  if (!window.confirm('恢复默认将清空全部自定义设置，确定继续？')) return;
  try {
    await api.post(`/themes/${selectedThemeId.value}/settings/reset`);
    toast.success('已恢复默认设置');
    await Promise.all([loadThemes(), loadSettings(selectedThemeId.value)]);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '恢复默认失败');
  }
}

async function preview(): Promise<void> {
  if (!selectedThemeId.value) return;
  try {
    const result = await api.post<{ url: string; expiresAt: string }>(
      `/themes/${selectedThemeId.value}/preview`,
      { values: { ...values } }
    );
    window.open(result.url, '_blank', 'noopener');
    toast.info('已在新标签页打开预览（草稿不会影响公众站点）');
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '预览创建失败');
  }
}

async function rollback(target: number): Promise<void> {
  if (!selectedThemeId.value) return;
  try {
    await api.post(`/themes/${selectedThemeId.value}/settings/rollback`, { revision: target });
    toast.success(`已回滚到 revision ${target}`);
    await Promise.all([loadThemes(), loadSettings(selectedThemeId.value)]);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '回滚失败');
  }
}

function pickPackage(): void {
  fileInput.value?.click();
}

async function uploadPackage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const result = await api.upload<{ themeId: string }>('/themes/install', formData);
    toast.success(`主题「${result.themeId}」安装成功`);
    await loadThemes();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '安装失败');
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

function setValue(key: string, value: unknown): void {
  values[key] = value;
}

watch(selectedThemeId, (id) => {
  if (id) void loadSettings(id);
});

onMounted(loadThemes);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">外观中心</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          主题零构建：theme.json + Nunjucks 模板 + 静态资源，切换主题不需要改动任何插件
        </p>
      </div>
      <div v-if="canManage">
        <input ref="fileInput" type="file" class="hidden" accept=".zip" @change="uploadPackage" />
        <Button variant="outline" :loading="uploading" @click="pickPackage">上传主题 ZIP</Button>
      </div>
    </header>

    <div class="flex gap-1 border-b border-border">
      <button
        type="button"
        :class="[
          'border-b-2 px-3.5 py-2 text-sm transition-colors',
          activeTab === 'installed'
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        ]"
        @click="activeTab = 'installed'"
      >
        已安装主题
      </button>
      <button
        type="button"
        :class="[
          'border-b-2 px-3.5 py-2 text-sm transition-colors',
          activeTab === 'settings'
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        ]"
        :disabled="!selectedThemeId"
        @click="activeTab = 'settings'"
      >
        主题设置{{ selectedTheme ? ` · ${selectedTheme.name}` : '' }}
      </button>
    </div>

    <!-- 主题网格 -->
    <div v-if="activeTab === 'installed'" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card v-for="theme in themes" :key="theme.id" hoverable class="flex flex-col overflow-hidden">
        <div class="flex h-40 items-center justify-center border-b border-border bg-muted/40">
          <img
            v-if="theme.screenshotUrl"
            :src="theme.screenshotUrl"
            :alt="`${theme.name} 预览图`"
            class="h-full w-full object-cover"
          />
          <span v-else class="text-xs text-muted-foreground">暂无预览图</span>
        </div>

        <div class="flex flex-1 flex-col p-4">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-foreground">{{ theme.name }}</h2>
            <Badge v-if="theme.active" variant="default">使用中</Badge>
          </div>
          <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ theme.id }} · v{{ theme.version }}</p>
          <p class="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {{ theme.description || '该主题未提供描述。' }}
          </p>

          <div v-if="theme.missingRequirements.length" class="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5">
            <p class="text-[11px] text-warning">缺少依赖能力：{{ theme.missingRequirements.join('、') }}</p>
          </div>

          <div class="mt-auto flex flex-wrap items-center gap-2 pt-4">
            <Button v-if="!theme.active && canManage" size="sm" @click="activate(theme)">
              <Check class="h-3.5 w-3.5" />
              激活
            </Button>
            <Button size="sm" variant="outline" @click="openSettings(theme)">
              <Eye class="h-3.5 w-3.5" />
              设置
            </Button>
          </div>
        </div>
      </Card>

      <Card v-if="themes.length === 0" class="p-10 text-center sm:col-span-2 lg:col-span-3">
        <p class="text-sm text-foreground">没有已安装的主题</p>
        <p class="mt-1 text-xs text-muted-foreground">请将主题目录放入 themes/ 或上传 ZIP 包。</p>
      </Card>
    </div>

    <!-- 设置表单：按 theme.json 声明自动生成 -->
    <div v-else class="flex flex-col gap-4">
      <Card v-if="!selectedTheme" class="p-8 text-center text-sm text-muted-foreground">
        请先在「已安装主题」中选择一个主题。
      </Card>

      <template v-else>
        <Card class="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p class="text-sm font-medium text-foreground">{{ selectedTheme.name }} 设置</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">
              当前 revision {{ revision }} · 保存使用乐观锁，冲突会提示重新加载
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" @click="preview">
              <ExternalLink class="h-3.5 w-3.5" />
              预览草稿
            </Button>
            <Button v-if="canManage" variant="outline" size="sm" @click="reset">
              <RotateCcw class="h-3.5 w-3.5" />
              恢复默认
            </Button>
            <Button v-if="canManage" size="sm" :loading="saving" @click="save">
              <Save class="h-3.5 w-3.5" />
              保存并发布
            </Button>
          </div>
        </Card>

        <SettingsForm
          :groups="groups"
          :values="values"
          :disabled="!canManage"
          @update="(key: string, value: unknown) => setValue(key, value)"
        />

        <Card class="p-5">
          <h2 class="text-sm font-semibold text-foreground">可供内容选择的页面模板</h2>
          <p class="mt-0.5 text-xs text-muted-foreground">
            在 theme.json 的 <span class="font-mono">pageTemplates</span> 中声明后，
            页面与文章编辑时即可从下列版式中选择；未声明时统一使用<span class="font-mono">templates.page</span>。
          </p>
          <ul v-if="selectedTheme?.pageTemplates.length" class="mt-3 flex flex-col divide-y divide-border">
            <li
              v-for="template in selectedTheme.pageTemplates"
              :key="template.key"
              class="flex flex-wrap items-baseline gap-x-2 py-2"
            >
              <span class="font-mono text-xs text-foreground">{{ template.key }}</span>
              <span class="text-xs text-foreground">{{ template.label }}</span>
              <span class="font-mono text-[11px] text-muted-foreground">templates/{{ template.template }}</span>
              <span v-if="template.description" class="w-full text-[11px] text-muted-foreground">
                {{ template.description }}
              </span>
            </li>
          </ul>
          <p v-else class="mt-2 text-xs text-muted-foreground">
            该主题未声明可选页面模板。
          </p>
        </Card>

        <Card v-if="history.length" class="p-5">
          <div class="flex items-center gap-2">
            <History class="h-4 w-4 text-muted-foreground" />
            <h2 class="text-sm font-semibold text-foreground">发布历史</h2>
          </div>
          <ul class="mt-3 flex flex-col divide-y divide-border">
            <li v-for="entry in history.slice(0, 8)" :key="entry.revision" class="flex items-center justify-between py-2.5">
              <span class="text-xs text-muted-foreground">
                revision {{ entry.revision }} · {{ formatDateTime(entry.createdAt) }}
              </span>
              <Button v-if="canManage" variant="ghost" size="sm" @click="rollback(entry.revision)">回滚到此版本</Button>
            </li>
          </ul>
        </Card>
      </template>
    </div>
  </div>
</template>
