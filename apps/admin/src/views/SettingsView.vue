<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { BookOpen, Cpu, Image, Save, ScrollText, Server, Upload, X } from 'lucide-vue-next';
import type { AuditLogEntry, MediaSummary, SiteSettings } from '@ricenote/shared';
import { api, ApiError, Badge, Button, Card, formatDateTime, Input, Label, Textarea } from '@ricenote/admin-sdk';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';

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
const saving = ref(false);
const uploading = ref<'logo' | 'favicon' | null>(null);

const logoInput = ref<HTMLInputElement | null>(null);
const faviconInput = ref<HTMLInputElement | null>(null);

const canViewAudit = auth.can('system.audit');
const canViewDiagnostics = auth.can('plugin.view');
const canManageSite = auth.can('theme.manage');

/** 可编辑的站点字段（与后端白名单一一对应）。 */
const form = reactive({
  title: '',
  description: '',
  language: '',
  url: '',
  logoUrl: '',
  faviconUrl: '',
  icpText: '',
  icpUrl: ''
});

const overridden = computed(() => new Set(site.value?.overridden ?? []));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<SiteSettings>('/site');
    site.value = data;
    form.title = data.title;
    form.description = data.description;
    form.language = data.language;
    form.url = data.url;
    form.logoUrl = data.logoUrl ?? '';
    form.faviconUrl = data.faviconUrl ?? '';
    form.icpText = data.icpText ?? '';
    form.icpUrl = data.icpUrl ?? '';

    if (canViewAudit) {
      const response = await api.list<AuditLogEntry>('/audit?pageSize=15');
      audit.value = response.data;
      auditTotal.value = response.total;
    }

    if (canViewDiagnostics) {
      const response = await api.get<CapabilitySnapshot>('/capabilities');
      snapshot.value = response as unknown as CapabilitySnapshot;
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '系统信息加载失败');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const data = await api.put<SiteSettings>('/site', {
      title: form.title,
      description: form.description,
      language: form.language,
      url: form.url,
      logoUrl: form.logoUrl,
      faviconUrl: form.faviconUrl,
      icpText: form.icpText,
      icpUrl: form.icpUrl,
      revision: site.value?.revision ?? 0
    });
    site.value = data;
    toast.success('站点信息已保存并即时生效');
  } catch (error) {
    if (error instanceof ApiError && error.isConflict) {
      toast.warning('站点信息已被其他会话修改，已为你重新加载');
      await load();
    } else {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

/** 上传 Logo / 图标：先进媒体库，再把返回的地址写入站点设置。 */
async function uploadImage(kind: 'logo' | 'favicon', event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = kind;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const media = await api.upload<MediaSummary>('/media', formData);
    if (kind === 'logo') form.logoUrl = media.url;
    else form.faviconUrl = media.url;
    toast.success('已上传，保存后生效');
  } catch (error) {
    toast.error(
      error instanceof ApiError
        ? `${error.message}（如媒体插件已禁用，请直接填写外部地址）`
        : '上传失败'
    );
  } finally {
    uploading.value = null;
    input.value = '';
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
          站点信息保存在数据库中并覆盖 .env 同名配置，保存后立即生效（无需重启）；部署级配置仍由 .env 管理。
        </p>
      </div>
      <Button variant="outline" :loading="loading" @click="load">刷新</Button>
    </header>

    <Card class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Server class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">站点信息</h2>
          <Badge variant="outline">revision {{ site?.revision ?? 0 }}</Badge>
          <Badge v-if="overridden.size" variant="muted">已覆盖 .env {{ overridden.size }} 项</Badge>
        </div>
        <Button v-if="canManageSite" :loading="saving" @click="save">
          <Save class="h-3.5 w-3.5" />
          保存站点信息
        </Button>
      </div>

      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <Label>站点标题</Label>
          <Input v-model="form.title" :maxlength="160" :disabled="!canManageSite" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>语言</Label>
          <Input v-model="form.language" :maxlength="20" placeholder="zh-CN" :disabled="!canManageSite" />
          <p class="text-[11px] text-muted-foreground">决定主题文案的解析语言（如 zh-CN / en）。</p>
        </div>
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <Label>站点描述</Label>
          <Textarea v-model="form.description" :rows="2" :disabled="!canManageSite" />
        </div>
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <Label>站点地址</Label>
          <Input v-model="form.url" type="url" placeholder="https://example.com" :disabled="!canManageSite" />
          <p class="text-[11px] text-muted-foreground">
            用于生成绝对链接（canonical、sitemap）。必须带 http(s) 前缀，末尾斜杠会自动去掉。
          </p>
        </div>
      </div>

      <div class="mt-5 border-t border-border pt-4">
        <div class="flex items-center gap-2">
          <Image class="h-4 w-4 text-muted-foreground" />
          <h3 class="text-sm font-medium text-foreground">外观标识</h3>
        </div>

        <div class="mt-3 grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label>站点 Logo</Label>
            <div class="flex items-center gap-2">
              <Input
                v-model="form.logoUrl"
                placeholder="/media/12 或 https://…"
                :disabled="!canManageSite"
              />
              <Button
                variant="outline"
                size="sm"
                :loading="uploading === 'logo'"
                :disabled="!canManageSite"
                @click="logoInput?.click()"
              >
                <Upload class="h-3.5 w-3.5" />
                上传
              </Button>
              <Button
                v-if="form.logoUrl"
                variant="ghost"
                size="sm"
                :disabled="!canManageSite"
                @click="form.logoUrl = ''"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
            <img
              v-if="form.logoUrl"
              :src="form.logoUrl"
              alt="Logo 预览"
              class="mt-1 h-12 w-auto rounded border border-border bg-card object-contain p-1"
            />
            <input
              ref="logoInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="uploadImage('logo', $event)"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label>站点图标（favicon）</Label>
            <div class="flex items-center gap-2">
              <Input
                v-model="form.faviconUrl"
                placeholder="/media/13 或 https://…"
                :disabled="!canManageSite"
              />
              <Button
                variant="outline"
                size="sm"
                :loading="uploading === 'favicon'"
                :disabled="!canManageSite"
                @click="faviconInput?.click()"
              >
                <Upload class="h-3.5 w-3.5" />
                上传
              </Button>
              <Button
                v-if="form.faviconUrl"
                variant="ghost"
                size="sm"
                :disabled="!canManageSite"
                @click="form.faviconUrl = ''"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
            <input
              ref="faviconInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="uploadImage('favicon', $event)"
            />
          </div>
        </div>
      </div>

      <div class="mt-5 border-t border-border pt-4">
        <h3 class="text-sm font-medium text-foreground">页脚备案</h3>
        <div class="mt-3 grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label>备案号文本</Label>
            <Input v-model="form.icpText" :maxlength="120" placeholder="京ICP备00000000号" :disabled="!canManageSite" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>备案查询链接</Label>
            <Input
              v-model="form.icpUrl"
              type="url"
              placeholder="https://beian.miit.gov.cn/"
              :disabled="!canManageSite"
            />
          </div>
        </div>
        <p class="mt-2 text-[11px] text-muted-foreground">
          主题可通过 <span class="font-mono">site.icpText</span> 与
          <span class="font-mono">site.icpUrl</span> 读取这两项（两套官方主题的页脚已接入）。
        </p>
      </div>

      <p v-if="!canManageSite" class="mt-3 text-[11px] text-warning">
        当前账号没有 <span class="font-mono">theme.manage</span> 权限，站点信息为只读。
      </p>
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
