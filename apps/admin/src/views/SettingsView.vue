<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { BookOpen, Cpu, ScrollText, Server } from 'lucide-vue-next';
import type { AuditLogEntry, SiteSettings } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import { formatDateTime } from '@/lib/utils';

interface CapabilitySnapshot {
  capabilities: string[];
  services: string[];
  events: { name: string; subscribers: number }[];
  slots: { slot: string; components: string[] }[];
  routes: {
    pages: { name: string; path: string; plugin: string }[];
    admin: { method: string; path: string; plugin: string; permission: string | null }[];
    raw: { method: string; path: string; plugin: string; capability: string }[];
  };
}

const auth = useAuth();
const toast = useToast();

const site = ref<SiteSettings | null>(null);
const audit = ref<AuditLogEntry[]>([]);
const auditTotal = ref(0);
const snapshot = ref<CapabilitySnapshot | null>(null);
const loading = ref(false);

const canViewAudit = auth.can('system.audit');
const canViewDiagnostics = auth.can('plugin.view');

async function load(): Promise<void> {
  loading.value = true;
  try {
    site.value = await api.get<SiteSettings>('/site');

    if (canViewAudit) {
      const response = await api.list<AuditLogEntry>('/audit?pageSize=15');
      audit.value = response.data;
      auditTotal.value = response.total;
    }

    if (canViewDiagnostics) {
      const response = await api.get<{ capabilities: string[]; services: string[]; events: CapabilitySnapshot['events']; slots: CapabilitySnapshot['slots']; routes: CapabilitySnapshot['routes'] }>(
        '/capabilities'
      );
      snapshot.value = response as unknown as CapabilitySnapshot;
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '系统信息加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">系统设置</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          站点信息、审计日志与运行时诊断。部署级配置通过 .env 管理，后台不提供任意配置写入。
        </p>
      </div>
      <Button variant="outline" :loading="loading" @click="load">刷新</Button>
    </header>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card class="p-5">
        <div class="flex items-center gap-2">
          <Server class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">站点信息</h2>
        </div>
        <dl class="mt-3 grid grid-cols-1 gap-y-2.5 text-xs sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground">站点标识</dt>
            <dd class="mt-0.5 font-mono text-foreground">{{ site?.siteId ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">标题</dt>
            <dd class="mt-0.5 text-foreground">{{ site?.title ?? '—' }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-muted-foreground">描述</dt>
            <dd class="mt-0.5 text-foreground">{{ site?.description || '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">站点地址</dt>
            <dd class="mt-0.5 break-all text-foreground">{{ site?.url ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">语言 / 激活主题</dt>
            <dd class="mt-0.5 text-foreground">{{ site?.language ?? '—' }} · {{ site?.activeThemeId ?? '—' }}</dd>
          </div>
        </dl>
      </Card>

      <Card class="p-5">
        <div class="flex items-center gap-2">
          <Cpu class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">运行时能力</h2>
        </div>

        <template v-if="snapshot">
          <p class="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">已启用能力契约</p>
          <div class="mt-1 flex flex-wrap gap-1">
            <Badge v-for="capability in snapshot.capabilities" :key="capability" variant="outline">{{ capability }}</Badge>
            <span v-if="snapshot.capabilities.length === 0" class="text-[11px] text-muted-foreground">无</span>
          </div>

          <p class="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">已注册服务</p>
          <div class="mt-1 flex flex-wrap gap-1">
            <Badge v-for="service in snapshot.services" :key="service" variant="muted">{{ service }}</Badge>
          </div>

          <p class="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">前台路由</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="route in snapshot.routes.pages" :key="route.name" class="font-mono text-[11px] text-muted-foreground">
              {{ route.path }} <span class="opacity-70">← {{ route.plugin }}</span>
            </li>
            <li v-if="snapshot.routes.pages.length === 0" class="text-[11px] text-muted-foreground">
              当前没有页面提供者插件（站点将进入安装与维护界面）
            </li>
          </ul>
        </template>

        <p v-else class="mt-3 text-xs text-muted-foreground">
          需要 `plugin.view` 权限才能查看运行时诊断信息。
        </p>
      </Card>
    </div>

    <Card class="p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <BookOpen class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">插槽与事件</h2>
        </div>
        <span class="text-[11px] text-muted-foreground">
          插槽 {{ snapshot?.slots.length ?? 0 }} · 事件 {{ snapshot?.events.length ?? 0 }}
        </span>
      </div>

      <div class="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">已注册插槽</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="slot in snapshot?.slots ?? []" :key="slot.slot" class="text-[11px] text-muted-foreground">
              <span class="font-mono text-foreground">{{ slot.slot }}</span>
              <span class="opacity-80"> ← {{ slot.components.join('、') }}</span>
            </li>
            <li v-if="(snapshot?.slots.length ?? 0) === 0" class="text-[11px] text-muted-foreground">
              暂无插件注册插槽
            </li>
          </ul>
        </div>

        <div>
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">事件订阅</p>
          <ul class="mt-1 flex flex-col gap-1">
            <li v-for="event in snapshot?.events ?? []" :key="event.name" class="text-[11px] text-muted-foreground">
              <span class="font-mono text-foreground">{{ event.name }}</span>
              <span class="opacity-80"> · {{ event.subscribers }} 个订阅</span>
            </li>
            <li v-if="(snapshot?.events.length ?? 0) === 0" class="text-[11px] text-muted-foreground">暂无事件订阅</li>
          </ul>
        </div>
      </div>
    </Card>

    <Card v-if="canViewAudit" class="p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <ScrollText class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">审计日志</h2>
        </div>
        <span class="text-[11px] text-muted-foreground">最近 {{ audit.length }} / 共 {{ auditTotal }} 条</span>
      </div>

      <div class="mt-3 overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border">
            <tr>
              <th class="rn-th w-44">时间</th>
              <th class="rn-th">操作</th>
              <th class="rn-th w-32">操作者</th>
              <th class="rn-th w-32 hidden md:table-cell">来源 IP</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="entry in audit" :key="entry.id" class="transition-colors hover:bg-muted/40">
              <td class="rn-td text-xs text-muted-foreground">{{ formatDateTime(entry.createdAt) }}</td>
              <td class="rn-td">
                <p class="font-mono text-xs text-foreground">{{ entry.action }}</p>
                <p v-if="entry.targetId" class="mt-0.5 text-[11px] text-muted-foreground">
                  {{ entry.targetType }}：{{ entry.targetId }}
                </p>
              </td>
              <td class="rn-td text-xs text-muted-foreground">{{ entry.actorName || '—' }}</td>
              <td class="rn-td hidden font-mono text-[11px] text-muted-foreground md:table-cell">{{ entry.ip || '—' }}</td>
            </tr>
            <tr v-if="audit.length === 0">
              <td class="rn-td py-8 text-center text-xs text-muted-foreground" colspan="4">暂无审计记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>
