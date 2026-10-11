<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import {
  Archive,
  ChevronDown,
  ExternalLink,
  FileStack,
  FileText,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Navigation,
  Palette,
  Puzzle,
  RotateCw,
  ScrollText,
  Settings,
  Shield,
  Tags,
  UserRound,
  Users,
  X
} from 'lucide-vue-next';
import type { AdminMenuItem } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import { useAuth } from '@/stores/auth';
import { useSystemState } from '@/stores/system';
import { useToast } from '@/stores/toast';
import { cn } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();
const system = useSystemState();
const route = useRoute();
const router = useRouter();

const drawerOpen = ref(false);
const userMenuOpen = ref(false);
const pluginMenu = ref<AdminMenuItem[]>([]);
const restartDialogOpen = ref(false);

/** 运行状态轮询间隔：让「重启」按钮在别处改动后也能及时出现。 */
const STATE_POLL_MS = 30_000;
let stateTimer: number | undefined;

const canRestart = computed(() => auth.can('system.restart'));
const showRestart = computed(() => system.restarting || (system.restartRequired.value && canRestart.value));

async function triggerRestart(): Promise<void> {
  restartDialogOpen.value = false;
  toast.info('已请求重启，服务恢复中…');
  try {
    const recovered = await system.restart();
    if (recovered) {
      toast.success('服务已重启并恢复');
      await loadMenu();
    } else {
      toast.warning('等待超时：请检查服务端日志确认重启结果');
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '重启请求失败');
  }
}

interface NavItem {
  /** 路由名（若该 name 未注册则为空，退化为普通链接）。 */
  name: string;
  /** 目标路径。 */
  path: string;
  label: string;
  icon: unknown;
  permission?: string;
}

/** Core 自有的固定入口；插件贡献的入口通过 /menu 动态合并。 */
const coreNav: NavItem[] = [
  { name: 'dashboard', path: '/', label: '仪表盘', icon: LayoutDashboard },
  { name: 'themes', path: '/themes', label: '外观中心', icon: Palette, permission: 'theme.view' },
  { name: 'plugins', path: '/plugins', label: '扩展中心', icon: Puzzle, permission: 'plugin.view' },
  { name: 'logs', path: '/logs', label: '运行日志', icon: ScrollText, permission: 'system.maintain' },
  { name: 'backup', path: '/backup', label: '备份与恢复', icon: Archive, permission: 'system.maintain' },
  { name: 'settings', path: '/settings', label: '系统设置', icon: Settings }
];

const pluginIcon: Record<string, unknown> = {
  FileText,
  FileStack,
  Tags,
  Image,
  Users,
  MessageSquare,
  Navigation,
  ShieldCheck: Shield
};

/**
 * 判断插件贡献的菜单路径是否有对应的前端路由。
 *
 * 这是必要的防御：插件可以声明任意 path，若后台没有对应页面，
 * 直接用 `RouterLink :to="{ name }"` 会抛出 "No match" 并让整个布局渲染失败。
 * 未注册的路径退化为普通链接（仍可访问，由具体页面自行处理）。
 */
function resolveRouteName(path: string): string {
  try {
    const resolved = router.resolve(path);
    return resolved.matched.length > 0 ? String(resolved.name ?? '') : '';
  } catch {
    return '';
  }
}

const navItems = computed(() => {
  const contributed = pluginMenu.value
    .filter((item) => auth.can(item.permission))
    .map<NavItem>((item) => ({
      name: resolveRouteName(item.path),
      path: item.path,
      label: item.label,
      icon: pluginIcon[item.icon ?? ''] ?? FileText,
      ...(item.permission ? { permission: item.permission } : {})
    }));

  const merged = [...coreNav.filter((item) => auth.can(item.permission)), ...contributed];
  return merged.filter(
    (item, index, list) => list.findIndex((candidate) => candidate.path === item.path) === index
  );
});

const activePath = computed(() => route.path);

function isActive(path: string): boolean {
  return activePath.value === path;
}

async function loadMenu(): Promise<void> {
  try {
    pluginMenu.value = await api.get<AdminMenuItem[]>('/menu');
  } catch {
    pluginMenu.value = [];
  }
}

async function handleLogout(): Promise<void> {
  await auth.logout();
  toast.info('已退出登录');
  await router.push({ name: 'login' });
}

onMounted(async () => {
  await Promise.all([loadMenu(), system.refresh()]);
  stateTimer = window.setInterval(() => void system.refresh(), STATE_POLL_MS);
});

onBeforeUnmount(() => {
  if (stateTimer !== undefined) window.clearInterval(stateTimer);
});
</script>

<template>
  <!-- 顶栏：固定定位 -->
  <header class="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4">
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="打开导航"
        @click="drawerOpen = true"
      >
        <Menu class="h-5 w-5" />
      </button>

      <a href="/" target="_blank" rel="noopener" class="flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">R</span>
        <span class="text-sm font-semibold tracking-wide text-foreground">RiceNote</span>
      </a>

      <span class="hidden rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
        管理后台
      </span>
    </div>

    <div class="flex items-center gap-2">
      <!-- 重启入口：仅在存在待生效变更时出现，避免顶栏噪声 -->
      <button
        v-if="showRestart"
        type="button"
        class="flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
        :disabled="system.restarting"
        :title="system.pendingReason.value || '存在需要重启才能生效的改动'"
        @click="restartDialogOpen = true"
      >
        <RotateCw :class="['h-3.5 w-3.5', system.restarting && 'animate-spin']" />
        <span class="hidden sm:inline">{{ system.restarting ? '正在重启' : '待重启' }}</span>
        <span v-if="!system.restarting" class="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      </button>

      <a
        href="/"
        target="_blank"
        rel="noopener"
        class="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
      >
        <ExternalLink class="h-3.5 w-3.5" />
        查看站点
      </a>

      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
          :aria-expanded="userMenuOpen"
          @click="userMenuOpen = !userMenuOpen"
        >
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
            {{ auth.displayName.value.slice(0, 1).toUpperCase() }}
          </span>
          <span class="hidden max-w-[9rem] truncate sm:inline">{{ auth.displayName.value }}</span>
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        <div
          v-if="userMenuOpen"
          class="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-card p-1.5 animate-fade-in"
        >
          <p class="px-2.5 py-1.5 text-xs text-muted-foreground">
            角色：{{ auth.user?.roles.join('、') || '无' }}
          </p>
          <div class="my-1 h-px bg-border" />
          <RouterLink
            :to="{ name: 'profile' }"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            @click="userMenuOpen = false"
          >
            <UserRound class="h-4 w-4" />
            个人资料
          </RouterLink>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-destructive transition-colors hover:bg-muted"
            @click="handleLogout"
          >
            <LogOut class="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- 侧边导航：桌面固定；窄屏抽屉 -->
  <aside
    :class="cn(
      'fixed bottom-0 left-0 top-14 z-30 w-60 border-r border-border bg-card p-3 transition-transform lg:translate-x-0',
      drawerOpen ? 'translate-x-0' : '-translate-x-full'
    )"
  >
    <div class="mb-3 flex items-center justify-between lg:hidden">
      <span class="text-xs font-medium text-muted-foreground">导航</span>
      <button
        type="button"
        class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
        aria-label="关闭导航"
        @click="drawerOpen = false"
      >
        <X class="h-4 w-4" />
      </button>
    </div>

    <nav class="flex flex-col gap-1">
      <template v-for="item in navItems" :key="item.path">
        <RouterLink
          v-if="item.name"
          :to="{ name: item.name }"
          :class="cn('rn-nav-item', isActive(item.path) && 'rn-nav-item--active')"
          @click="drawerOpen = false"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.label }}</span>
        </RouterLink>
        <a
          v-else
          :href="item.path"
          :class="cn('rn-nav-item', isActive(item.path) && 'rn-nav-item--active')"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.label }}</span>
        </a>
      </template>
    </nav>

    <div class="mt-6 rounded-lg border border-border p-3">
      <p class="text-xs font-medium text-foreground">插件优先架构</p>
      <p class="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        内容、分类、媒体等能力均由插件提供，可在「扩展中心」中独立启停。
      </p>
    </div>
  </aside>

  <div v-if="drawerOpen" class="fixed inset-0 z-20 bg-foreground/30 lg:hidden" @click="drawerOpen = false" />

  <!-- 主内容区：为固定顶栏与侧栏留出空间 -->
  <main class="min-h-screen pt-14 lg:pl-60">
    <!-- 重启进行中的轻量提示条：服务恢复后自动消失 -->
    <div
      v-if="system.restarting"
      class="fixed inset-x-0 top-14 z-30 flex flex-wrap items-center justify-center gap-2 border-b border-border bg-primary/10 px-4 py-2 text-xs text-foreground lg:left-60"
    >
      <RotateCw class="h-3.5 w-3.5 animate-spin" />
      <span>服务重启中 · {{ system.phase }} 请稍候，恢复后页面会自动可用</span>
    </div>

    <div class="mx-auto max-w-6xl px-5 py-6">
      <RouterView />
    </div>
  </main>

  <!-- 重启确认：重启会短暂中断站点访问，必须显式确认 -->
  <Dialog
    v-model:open="restartDialogOpen"
    title="重启服务"
    description="重启会短暂中断站点访问"
    width="sm"
  >
    <div class="rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <p class="text-xs leading-relaxed text-muted-foreground">
        重启将优雅关停插件与数据库连接，随后重新装配内核并监听同一端口（通常数秒）。
        期间访问会返回 503，前端会等待服务恢复。
      </p>
      <p v-if="system.pendingReason.value" class="mt-2 text-xs text-foreground">
        待生效原因：{{ system.pendingReason.value }}
      </p>
    </div>

    <template #footer>
      <Button variant="ghost" @click="restartDialogOpen = false">取消</Button>
      <Button @click="triggerRestart">
        <RotateCw class="h-3.5 w-3.5" />
        立即重启
      </Button>
    </template>
  </Dialog>
</template>
