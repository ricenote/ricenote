<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Copy, Image as ImageIcon, Search, Trash2, Upload } from 'lucide-vue-next';
import type { MediaSummary } from '@ricenote/shared';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import { formatBytes, formatDateTime } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();

const items = ref<MediaSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 24;
const keyword = ref('');
const loading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const canManage = auth.can('media.manage');
const totalPages = Math.ceil(total.value / pageSize);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
    const response = await api.list<MediaSummary>(`/media?${query.toString()}`);
    items.value = response.data;
    total.value = response.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '媒体列表加载失败');
  } finally {
    loading.value = false;
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  uploading.value = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const created = await api.upload<MediaSummary>('/media', formData);
    toast.success(`已上传 ${created.fileName}`);
    page.value = 1;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '上传失败');
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

async function remove(media: MediaSummary): Promise<void> {
  if (!window.confirm(`删除「${media.fileName}」将同时移除磁盘文件，确定继续？`)) return;
  try {
    await api.delete(`/media/${media.id}`);
    toast.success('媒体已删除');
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '删除失败');
  }
}

async function copyUrl(media: MediaSummary): Promise<void> {
  const absolute = `${window.location.origin}${media.url}`;
  try {
    await navigator.clipboard.writeText(absolute);
    toast.success('已复制访问地址');
  } catch {
    toast.info(absolute);
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">媒体库</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          共 {{ total }} 个文件 · 仅允许白名单扩展名，文件名随机化后落盘
        </p>
      </div>
      <div v-if="canManage">
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.pdf,.txt,.md,.zip"
          @change="onFileChange"
        />
        <Button :loading="uploading" @click="pickFile">
          <Upload class="h-4 w-4" />
          上传文件
        </Button>
      </div>
    </header>

    <Card class="flex flex-wrap items-center gap-3 p-3.5">
      <div class="relative min-w-[14rem] flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="按文件名搜索" @enter="() => { page = 1; load(); }" />
      </div>
      <Button variant="outline" :loading="loading" @click="() => { page = 1; load(); }">查询</Button>
    </Card>

    <div v-if="items.length" class="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <Card v-for="media in items" :key="media.id" hoverable class="overflow-hidden">
        <div class="flex h-36 items-center justify-center border-b border-border bg-muted/40">
          <img
            v-if="media.mimeType.startsWith('image/')"
            :src="media.url"
            :alt="media.alt || media.fileName"
            class="h-full w-full object-cover"
            loading="lazy"
          />
          <ImageIcon v-else class="h-8 w-8 text-muted-foreground" />
        </div>

        <div class="p-3">
          <p class="truncate text-sm text-foreground" :title="media.fileName">{{ media.fileName }}</p>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            {{ formatBytes(media.size) }} · {{ formatDateTime(media.createdAt) }}
          </p>

          <div class="mt-2.5 flex items-center gap-1.5">
            <Button variant="outline" size="sm" @click="copyUrl(media)">
              <Copy class="h-3.5 w-3.5" />
              复制地址
            </Button>
            <button
              v-if="canManage"
              type="button"
              class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              title="删除"
              @click="remove(media)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Card>
    </div>

    <Card v-else class="p-12 text-center">
      <ImageIcon class="mx-auto h-8 w-8 text-muted-foreground" />
      <p class="mt-3 text-sm text-foreground">媒体库为空</p>
      <p class="mt-1 text-xs text-muted-foreground">
        上传的图片可在主题设置中通过 image 字段选用。
      </p>
    </Card>

    <div v-if="totalPages > 1" class="flex items-center justify-between">
      <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" :disabled="page <= 1" @click="() => { page -= 1; load(); }">上一页</Button>
        <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="() => { page += 1; load(); }">下一页</Button>
      </div>
    </div>
  </div>
</template>
