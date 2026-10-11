<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Shield, ShieldCheck, UserCog } from 'lucide-vue-next';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import Label from '@/components/ui/Label.vue';
import Select from '@/components/ui/Select.vue';

interface RoleDefinition {
  id: number;
  name: string;
  description?: string;
  permissions: string[];
  builtin: boolean;
}

interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
}

const auth = useAuth();
const toast = useToast();

const roles = ref<RoleDefinition[]>([]);
const permissions = ref<PermissionDefinition[]>([]);
const loading = ref(false);

const assignUserId = ref('');
const assignRole = ref('contributor');
const assigning = ref(false);

const canManage = computed(() => auth.can('user.manage'));

const groupedPermissions = computed(() => {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const permission of permissions.value) {
    const bucket = groups.get(permission.group) ?? [];
    bucket.push(permission);
    groups.set(permission.group, bucket);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [roleList, permissionList] = await Promise.all([
      api.get<RoleDefinition[]>('/roles'),
      api.get<PermissionDefinition[]>('/permissions')
    ]);
    roles.value = roleList;
    permissions.value = permissionList;
    if (roleList.length > 0 && !roleList.some((role) => role.name === assignRole.value)) {
      assignRole.value = roleList[0]!.name;
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '角色数据加载失败');
  } finally {
    loading.value = false;
  }
}

async function assign(): Promise<void> {
  const userId = Number.parseInt(assignUserId.value, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    toast.warning('请输入合法的用户 ID');
    return;
  }

  assigning.value = true;
  try {
    await api.post(`/users/${userId}/roles`, { role: assignRole.value });
    toast.success(`已为用户 ${userId} 分配角色 ${assignRole.value}`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : '分配失败');
  } finally {
    assigning.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-foreground">角色与权限</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          权限点由 Core 的安全网关执行 fail-closed 校验；内置角色的权限集合以插件代码为准，每次启动同步
        </p>
      </div>
      <Button variant="outline" :loading="loading" @click="load">刷新</Button>
    </header>

    <Card v-if="canManage" class="p-5">
      <div class="flex items-center gap-2">
        <UserCog class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-sm font-semibold text-foreground">为用户分配角色</h2>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">
        填入用户 ID 并选择角色。移除管理员角色时，系统会阻止把最后一个管理员降级。
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="flex flex-col gap-1.5">
          <Label>用户 ID</Label>
          <Input v-model="assignUserId" type="number" placeholder="例如 2" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>角色</Label>
          <Select
            v-model="assignRole"
            :options="roles.map((role) => ({ label: role.name, value: role.name }))"
          />
        </div>
        <div class="flex items-end">
          <Button :loading="assigning" @click="assign">
            <ShieldCheck class="h-4 w-4" />
            分配角色
          </Button>
        </div>
      </div>
    </Card>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card v-for="role in roles" :key="role.id" hoverable class="p-5">
        <div class="flex items-center gap-2">
          <Shield class="h-4 w-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold text-foreground">{{ role.name }}</h2>
          <Badge v-if="role.builtin" variant="outline">内置</Badge>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">{{ role.description || '未提供描述' }}</p>

        <div class="mt-3 flex flex-wrap gap-1">
          <Badge v-if="role.permissions.includes('*')" variant="default">全部权限</Badge>
          <Badge v-for="permission in role.permissions.filter((item) => item !== '*')" :key="permission" variant="outline">
            {{ permission }}
          </Badge>
          <span v-if="role.permissions.length === 0" class="text-[11px] text-muted-foreground">未授予任何权限</span>
        </div>
      </Card>
    </div>

    <Card class="p-5">
      <h2 class="text-sm font-semibold text-foreground">权限点目录</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        插件通过 <code class="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[11px]">ctx.routes.adminApi({ permission })</code>
        声明所需权限点，Core 在路由层统一校验。
      </p>

      <div class="mt-4 flex flex-col gap-4">
        <div v-for="group in groupedPermissions" :key="group.group">
          <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{{ group.group }}</p>
          <div class="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="permission in group.items"
              :key="permission.key"
              class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
            >
              <span class="font-mono text-[11px] text-foreground">{{ permission.key }}</span>
              <span class="text-[11px] text-muted-foreground">{{ permission.label }}</span>
            </div>
          </div>
        </div>
        <p v-if="groupedPermissions.length === 0" class="text-xs text-muted-foreground">
          需要 user.manage 权限才能查看权限点目录。
        </p>
      </div>
    </Card>
  </div>
</template>
