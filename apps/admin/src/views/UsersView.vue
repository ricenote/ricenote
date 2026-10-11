<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Plus, Search, UserPlus } from 'lucide-vue-next';
import type { AdminUserSummary } from '@ricenote/shared';
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
import { formatDateTime } from '@/lib/utils';

const auth = useAuth();
const toast = useToast();

const users = ref<AdminUserSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const keyword = ref('');
const loading = ref(false);

const dialogOpen = ref(false);
const saving = ref(false);
const roles = ref<{ id: number; name: string }[]>([]);

const form = reactive({ username: '', displayName: '', email: '', password: '', role: 'contributor' });

const canManage = computed(() => auth.can('user.manage'));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const query = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) });
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
    const response = await api.list<AdminUserSummary>(`/users?${query.toString()}`);
    users.value = response.data;
    total.value = response.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '用户列表加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadRoles(): Promise<void> {
  try {
    const list = await api.get<{ name: string }[]>('/roles');
    roles.value = list.map((item, index) => ({ id: index, name: item.name }));
  } catch {
    roles.value = [];
  }
}

function openCreate(): void {
  form.username = '';
  form.displayName = '';
  form.email = '';
  form.password = '';
  form.role = 'contributor';
  dialogOpen.value = true;
}

async function create(): Promise<void> {
  if (!form.username.trim() || !form.email.trim() || !form.password) {
    toast.warning('用户名、邮箱与密码均为必填项');
    return;
  }

  saving.value = true;
  try {
    await api.post('/users', {
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role
    });
    toast.success(`用户 ${form.username} 已创建`);
    dialogOpen.value = false;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '创建失败');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), loadRoles()]);
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">用户</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          共 {{ total }} 个账号 · 由 identity 插件管理，角色分派由 authorization 插件负责
        </p>
      </div>
      <Button v-if="canManage" @click="openCreate">
        <UserPlus class="h-4 w-4" />
        新建用户
      </Button>
    </header>

    <Card class="flex flex-wrap items-center gap-3 p-3.5">
      <div class="relative min-w-[14rem] flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="搜索用户名、昵称或邮箱" @enter="() => { page = 1; load(); }" />
      </div>
      <Button variant="outline" :loading="loading" @click="() => { page = 1; load(); }">查询</Button>
    </Card>

    <Card class="overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead class="border-b border-border bg-muted/50">
            <tr>
              <th class="rn-th">用户</th>
              <th class="rn-th w-48">角色</th>
              <th class="rn-th w-28">状态</th>
              <th class="rn-th w-40 hidden lg:table-cell">最后登录</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="user in users" :key="user.id" class="transition-colors hover:bg-muted/40">
              <td class="rn-td">
                <p class="font-medium text-foreground">{{ user.displayName }}</p>
                <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {{ user.username }} · {{ user.email }}
                </p>
              </td>
              <td class="rn-td">
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="role in user.roles" :key="role" variant="default">{{ role }}</Badge>
                  <span v-if="user.roles.length === 0" class="text-xs text-muted-foreground">未分配</span>
                </div>
              </td>
              <td class="rn-td">
                <Badge :variant="user.status === 'active' ? 'success' : 'muted'">
                  {{ user.status === 'active' ? '正常' : '已禁用' }}
                </Badge>
              </td>
              <td class="rn-td hidden text-xs text-muted-foreground lg:table-cell">
                {{ formatDateTime(user.lastLoginAt) }}
              </td>
            </tr>
            <tr v-if="!loading && users.length === 0">
              <td class="rn-td py-10 text-center text-sm text-muted-foreground" colspan="4">
                暂无用户，或 identity 插件未启用。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-border px-3.5 py-2.5">
        <span class="text-xs text-muted-foreground">第 {{ page }} / {{ totalPages }} 页</span>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" :disabled="page <= 1" @click="() => { page -= 1; load(); }">上一页</Button>
          <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="() => { page += 1; load(); }">下一页</Button>
        </div>
      </div>
    </Card>

    <Dialog v-model:open="dialogOpen" title="新建用户" description="新用户默认获得所选角色；首个用户会自动成为管理员。" width="sm">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label required>用户名</Label>
          <Input v-model="form.username" placeholder="需以字母开头，长度 3-64" autocomplete="off" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>显示名</Label>
          <Input v-model="form.displayName" placeholder="留空则与用户名一致" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label required>邮箱</Label>
          <Input v-model="form.email" type="email" placeholder="user@example.com" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label required>初始密码</Label>
          <Input v-model="form.password" type="password" placeholder="至少 8 位，不能为纯数字" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>角色</Label>
          <Select
            v-model="form.role"
            :options="
              (roles.length ? roles : [{ id: 0, name: 'contributor' }]).map((role) => ({
                label: role.name,
                value: role.name
              }))
            "
          />
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="create">
          <Plus class="h-4 w-4" />
          创建
        </Button>
      </template>
    </Dialog>
  </div>
</template>
