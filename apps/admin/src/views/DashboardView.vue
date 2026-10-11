<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  FileText,
  Image,
  Palette,
  Puzzle,
  RefreshCw,
  Users
} from 'lucide-vue-next';
import type { DashboardStats, PluginSummary } from '@ricenote/shared';
import { api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import { formatDateTime, formatDuration } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();

const stats = ref<DashboardStats | null>(null);
const missingServices = ref<string[]>([]);
const loading = ref(true);

const failedPlugins = computed<PluginSummary[]>(
  () => stats.value?.plugins.filter((item) => item.state === 'FAILED') ?? []
);

const alerts = computed(() => {
  const list: string[] = [];
  if (failedPlugins.value.length > 0) {
    list.push(`有 ${failedPlugins.value.length} 个插件处于失败状态`);
  }
  if (missingServices.value.length > 0) {
    list.push(`缺少服务：${missingServices.value.join('、')}`);
  }
  return list;
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.raw<{ data: DashboardStats; missingServices: string[] }>('GET', '/dashboard');
    stats.value = response.data;
    missingServices.value = response.missingServices;
  } catch {
    toast.error('仪表盘数据加载失败');
  } finally {
    loading.value = false;
  }
}

const stateTone: Record<string, 'success' | 'warning' | 'error' | 'muted'> = {
  STARTED: 'success',
  ENABLED: 'warning',
  FAILED: 'error'
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">
          你好，{{ auth.displayName.value }}
        </h1>
        <p class="mt-1 text-xs text-muted-foreground">
          站点运行状态、内容与插件健康概览
        </p>
      </div>
      <Button variant="outline" size="sm" :loading="loading" @click="load">
        <RefreshCw class="h-3.5 w-3.5" />
        刷新
      </Button>
    </header>

    <!-- 告警 -->
    <Card v-if="alerts.length" class="border-destructive/40 p-4">
      <div class="flex items-start gap-2.5">
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div class="flex flex-col gap-1">
          <p class="text-sm font-medium text-foreground">需要注意</p>
          <ul class="list-inside list-disc text-xs text-muted-foreground">
            <li v-for="item in alerts" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </Card>

    <!-- 站点状态 -->
    <Card class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-wide text-muted-foreground">站点状态</p>
          <div class="mt-1.5 flex items-center gap-2">
            <Badge :variant="failedPlugins.length ? 'warning' : 'success'">
              {{ failedPlugins.length ? '存在插件异常' : '运行正常' }}
            </Badge>
            <span class="text-sm text-muted-foreground">RiceNote v{{ stats?.site.version ?? '—' }}</span>
          </div>
        </div>

        <dl class="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt class="text-muted-foreground">运行时长</dt>
            <dd class="mt-0.5 flex items-center gap-1 font-medium text-foreground">
              <Clock class="h-3.5 w-3.5 text-muted-foreground" />
              {{ formatDuration(stats?.site.uptimeSeconds ?? 0) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Node 版本</dt>
            <dd class="mt-0.5 flex items-center gap-1 font-medium text-foreground">
              <Activity class="h-3.5 w-3.5 text-muted-foreground" />
              {{ stats?.site.nodeVersion ?? '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">激活主题</dt>
            <dd class="mt-0.5 flex items-center gap-1 font-medium text-foreground">
              <Palette class="h-3.5 w-3.5 text-muted-foreground" />
              {{ stats?.site.themeId || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground">插件总数</dt>
            <dd class="mt-0.5 flex items-center gap-1 font-medium text-foreground">
              <Puzzle class="h-3.5 w-3.5 text-muted-foreground" />
              {{ stats?.site.pluginCount ?? 0 }}
            </dd>
          </div>
        </dl>
      </div>
    </Card>

    <!-- 统计卡组 -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card hoverable class="p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">文章总数</p>
          <FileText class="h-4 w-4 text-muted-foreground" />
        </div>
        <p class="mt-2 text-2xl font-semibold text-foreground">{{ stats?.content.total ?? 0 }}</p>
        <p class="mt-1 text-[11px] text-muted-foreground">
          已发布 {{ stats?.content.published ?? 0 }} · 草稿 {{ stats?.content.draft ?? 0 }}
        </p>
      </Card>

      <Card hoverable class="p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">用户</p>
          <Users class="h-4 w-4 text-muted-foreground" />
        </div>
        <p class="mt-2 text-2xl font-semibold text-foreground">{{ stats?.users.total ?? 0 }}</p>
        <p class="mt-1 text-[11px] text-muted-foreground">在线会话 {{ stats?.users.activeSessions ?? 0 }}</p>
      </Card>

      <Card hoverable class="p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">媒体文件</p>
          <Image class="h-4 w-4 text-muted-foreground" />
        </div>
        <p class="mt-2 text-2xl font-semibold text-foreground">{{ stats?.media.total ?? 0 }}</p>
        <p class="mt-1 text-[11px] text-muted-foreground">占用 {{ stats?.media.totalSize ?? 0 }} 字节</p>
      </Card>

      <Card hoverable class="p-4">
        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">缓存条目</p>
          <Database class="h-4 w-4 text-muted-foreground" />
        </div>
        <p class="mt-2 text-2xl font-semibold text-foreground">—</p>
        <p class="mt-1 text-[11px] text-muted-foreground">详见「系统设置 → 诊断」</p>
      </Card>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- 最近文章 -->
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-foreground">最近更新</h2>
          <RouterLink :to="{ name: 'posts' }" class="text-xs text-muted-foreground underline-offset-2 hover:underline">
            全部文章
          </RouterLink>
        </div>

        <ul v-if="stats?.recentPosts.length" class="mt-3 flex flex-col divide-y divide-border">
          <li v-for="post in stats.recentPosts" :key="post.id" class="flex items-center justify-between gap-3 py-2.5">
            <div class="min-w-0">
              <a
                :href="`/post/${post.slug}`"
                target="_blank"
                rel="noopener"
                class="truncate text-sm text-foreground hover:text-primary"
              >
                {{ post.title }}
              </a>
              <p class="mt-0.5 text-[11px] text-muted-foreground">{{ formatDateTime(post.updatedAt) }}</p>
            </div>
            <Badge :variant="post.status === 'published' ? 'success' : 'muted'">
              {{ post.status === 'published' ? '已发布' : post.status === 'draft' ? '草稿' : '已归档' }}
            </Badge>
          </li>
        </ul>
        <p v-else class="mt-3 text-xs text-muted-foreground">
          还没有文章。前往「文章」页面创建第一篇内容。
        </p>
      </Card>

      <!-- 插件健康 -->
      <Card class="p-5">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-foreground">插件健康</h2>
          <RouterLink :to="{ name: 'plugins' }" class="text-xs text-muted-foreground underline-offset-2 hover:underline">
            扩展中心
          </RouterLink>
        </div>

        <ul class="mt-3 flex flex-col divide-y divide-border">
          <li
            v-for="plugin in stats?.plugins ?? []"
            :key="plugin.id"
            class="flex items-center justify-between gap-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="truncate text-sm text-foreground">{{ plugin.name }}</p>
              <p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {{ plugin.id }} · v{{ plugin.version }}
              </p>
            </div>
            <Badge :variant="stateTone[plugin.state] ?? 'outline'">{{ plugin.state }}</Badge>
          </li>
        </ul>
      </Card>
    </div>
  </div>
</template>
