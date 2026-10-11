<script setup lang="ts">
/**
 * 扩展中心「官方插件目录」。
 *
 * 官方插件随主程序发布（推荐版本写在 `plugin-catalog.json` 里），这里做三件事：
 * - 列出**尚未安装**的官方插件并支持一键安装；
 * - 已装版本低于推荐版本时给出"可更新"与更新按钮；
 * - 明确区分「随仓库分发」（开发期形态，不可卸载）与「从 npm 安装」（可更新可卸载）。
 *
 * 视觉沿用既有语言：1px 细边框分层、无阴影、无毛玻璃，与插件卡片一致。
 */
import { computed, onMounted, ref } from 'vue';
import { Download, PackagePlus, RefreshCw } from 'lucide-vue-next';
import type { CatalogPluginDto, PluginJobDto } from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, useToast } from '@ricenote/admin-sdk';

const props = defineProps<{ canInstall: boolean }>();
const emit = defineEmits<{ (event: 'job', job: PluginJobDto): void }>();

const toast = useToast();
const entries = ref<CatalogPluginDto[]>([]);
const loading = ref(false);
const busyId = ref<string | null>(null);

/** 分类徽章的文案与色调。 */
const CATEGORY: Record<
  CatalogPluginDto['category'],
  { label: string; tone: 'default' | 'warning' | 'outline' | 'muted' }
> = {
  required: { label: '必需', tone: 'warning' },
  recommended: { label: '推荐', tone: 'default' },
  optional: { label: '可选', tone: 'outline' },
  example: { label: '示例', tone: 'muted' }
};

/** 未安装在前、可更新其次，最后是已是最新 —— 让"能做的事"浮到上面。 */
const sorted = computed(() =>
  [...entries.value].sort((left, right) => rank(left) - rank(right))
);

function rank(entry: CatalogPluginDto): number {
  if (!entry.installed) return 0;
  if (entry.updateToRecommended) return 1;
  return 2;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.raw<{ data: CatalogPluginDto[] }>('GET', '/plugins/catalog');
    entries.value = response.data;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '官方插件目录加载失败');
  } finally {
    loading.value = false;
  }
}

/** 未安装 → 按推荐版本安装；已装但落后 → 走更新（沿用已记录的来源）。 */
async function act(entry: CatalogPluginDto): Promise<void> {
  busyId.value = entry.id;
  try {
    const job = entry.installed
      ? await api.post<PluginJobDto>(`/plugins/${entry.id}/update`, {})
      : await api.post<PluginJobDto>('/plugins/install/source', {
          source: { type: 'registry', spec: `${entry.npm}@${entry.version}` }
        });

    emit('job', job);
    toast.info(`已提交 ${entry.label} 的${entry.installed ? '更新' : '安装'}任务`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '任务提交失败');
  } finally {
    busyId.value = null;
  }
}

onMounted(load);

defineExpose({ load });
</script>

<template>
  <Card class="p-4">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <PackagePlus class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-sm font-semibold text-foreground">官方插件目录</h2>
        <Badge variant="outline">{{ entries.length }} 项</Badge>
      </div>
      <Button variant="ghost" size="sm" :loading="loading" @click="load">
        <RefreshCw class="h-3 w-3" />
        刷新
      </Button>
    </div>
    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
      官方插件随主程序发布，按<strong class="text-foreground">推荐版本</strong>安装；
      这里是"经测试可用"的版本组合，与 registry 上的最新版本是两件事。
      安装与更新都在后台串行执行，可实时查看日志。
    </p>

    <ul class="mt-3 flex flex-col divide-y divide-border border-t border-border">
      <li
        v-for="entry in sorted"
        :key="entry.id"
        class="flex flex-wrap items-start justify-between gap-3 py-3 transition-colors hover:bg-muted/40"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-foreground">{{ entry.label }}</span>
            <Badge :variant="CATEGORY[entry.category].tone">{{ CATEGORY[entry.category].label }}</Badge>
            <span class="font-mono text-[11px] text-muted-foreground">{{ entry.id }}</span>
            <span v-if="entry.category === 'required'" class="text-[11px] text-warning">
              缺少它无法登录后台
            </span>
          </div>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ entry.description }}</p>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <span v-if="!entry.installed" class="text-[11px] text-muted-foreground">
            未安装 · 推荐 v{{ entry.version }}
          </span>
          <Badge v-else-if="entry.builtin" variant="muted">随仓库分发 v{{ entry.installedVersion }}</Badge>
          <Badge v-else-if="entry.updateToRecommended" variant="warning">
            可更新到 v{{ entry.version }}
          </Badge>
          <Badge v-else variant="success">已安装 v{{ entry.installedVersion }}</Badge>

          <Button
            v-if="canInstall && !entry.installed"
            size="sm"
            :loading="busyId === entry.id"
            @click="act(entry)"
          >
            <Download class="h-3.5 w-3.5" />
            安装
          </Button>
          <Button
            v-else-if="canInstall && entry.updateToRecommended && !entry.builtin"
            variant="outline"
            size="sm"
            :loading="busyId === entry.id"
            @click="act(entry)"
          >
            <Download class="h-3.5 w-3.5" />
            更新
          </Button>
        </div>
      </li>
    </ul>
  </Card>
</template>
