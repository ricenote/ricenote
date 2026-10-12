/**
 * authorization 插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（AdminPage/Card/Button/Select/…）已由宿主全局注册，模板里直接写标签即可；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径是 `/api/admin` 之后的相对路径。
 *
 * 迁移前该界面位于 `apps/admin/src/views/RolesView.vue`，行为与文案保持一致：
 * 角色列表（含内置标记与权限点）、权限点目录、为用户分配角色。
 */

import {
  api,
  computed,
  defineAdminPage,
  onMounted,
  ref,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminPage({
  title: '角色与权限',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('user.manage'));

    const roles = ref([]);
    const permissions = ref([]);
    const loading = ref(false);

    const assignUserId = ref('');
    const assignRole = ref('contributor');
    const assigning = ref(false);

    const groupedPermissions = computed(() => {
      const groups = new Map();
      for (const permission of permissions.value) {
        const bucket = groups.get(permission.group) ?? [];
        bucket.push(permission);
        groups.set(permission.group, bucket);
      }
      return [...groups.entries()].map(([group, items]) => ({ group, items }));
    });

    const roleOptions = computed(() =>
      roles.value.map((role) => ({ label: role.name, value: role.name }))
    );

    /** 角色已授予的显式权限点（`*` 单独用「全部权限」徽标展示）。 */
    function grantedPermissions(role) {
      return role.permissions.filter((item) => item !== '*');
    }

    /** 权限点的对外显示名（未收录时回退为原始标识）。 */
    function permissionLabelOf(key) {
      const matched = permissions.value.find((item) => item.key === key);
      return matched && matched.label ? matched.label : key;
    }

    async function load() {
      loading.value = true;
      try {
        const [roleList, permissionList] = await Promise.all([
          api.get('/roles'),
          api.get('/permissions')
        ]);
        roles.value = roleList;
        permissions.value = permissionList;
        if (roleList.length > 0 && !roleList.some((role) => role.name === assignRole.value)) {
          assignRole.value = roleList[0].name;
        }
      } catch (error) {
        toast.error(messageOf(error, '角色数据加载失败'));
      } finally {
        loading.value = false;
      }
    }

    async function assign() {
      const userId = Number.parseInt(assignUserId.value, 10);
      if (!Number.isInteger(userId) || userId <= 0) {
        toast.warning('请输入合法的用户编号');
        return;
      }

      assigning.value = true;
      try {
        await api.post(`/users/${userId}/roles`, { role: assignRole.value });
        toast.success(`已为用户 ${userId} 分配角色 ${assignRole.value}`);
      } catch (error) {
        toast.error(messageOf(error, '分配失败'));
      } finally {
        assigning.value = false;
      }
    }

    onMounted(load);

    return {
      assign,
      assignRole,
      assignUserId,
      assigning,
      canManage,
      grantedPermissions,
      groupedPermissions,
      load,
      loading,
      permissionLabelOf,
      roleOptions,
      roles
    };
  },

  template: `
<AdminPage
  title="角色与权限"
  description="为用户分配角色，并查看各角色拥有的权限"
>
  <template #actions>
    <Button variant="outline" :loading="loading" @click="load">刷新</Button>
  </template>

  <Card v-if="canManage" class="p-5">
    <div class="flex items-center gap-2">
      <Icon name="usercog" class="h-4 w-4 text-muted-foreground" />
      <h2 class="text-sm font-semibold text-foreground">为用户分配角色</h2>
    </div>
    <p class="mt-1 text-xs text-muted-foreground">
      填入用户 ID 并选择角色。移除管理员角色时，系统会阻止把最后一个管理员降级。
    </p>

    <div class="mt-4 grid gap-3 sm:grid-cols-3">
      <Field label="用户编号">
        <Input v-model="assignUserId" type="number" placeholder="例如 2" />
      </Field>
      <Field label="角色">
        <Select v-model="assignRole" :options="roleOptions" />
      </Field>
      <div class="flex items-end">
        <Button :loading="assigning" @click="assign">
          <Icon name="shieldcheck" />
          分配角色
        </Button>
      </div>
    </div>
  </Card>

  <div class="grid gap-4 lg:grid-cols-2">
    <Card v-for="role in roles" :key="role.id" hoverable class="p-5">
      <div class="flex items-center gap-2">
        <Icon name="shield" class="h-4 w-4 text-muted-foreground" />
        <h2 class="text-sm font-semibold text-foreground">{{ role.name }}</h2>
        <Badge v-if="role.builtin" variant="outline">内置</Badge>
      </div>
      <p class="mt-1 text-xs text-muted-foreground">{{ role.description || '未提供描述' }}</p>

      <div class="mt-3 flex flex-wrap gap-1">
        <Badge v-if="role.permissions.includes('*')" variant="default">全部权限</Badge>
        <Badge v-for="permission in grantedPermissions(role)" :key="permission" variant="outline">
          {{ permissionLabelOf(permission) }}
        </Badge>
        <span v-if="role.permissions.length === 0" class="text-[11px] text-muted-foreground">未授予任何权限</span>
      </div>
    </Card>
  </div>

  <Card class="p-5">
    <h2 class="text-sm font-semibold text-foreground">权限目录</h2>

    <div class="mt-4 flex flex-col gap-4">
      <div v-for="group in groupedPermissions" :key="group.group">
        <p class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{{ group.group }}</p>
        <div class="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="permission in group.items" :key="permission.key"
            class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
            <span class="text-[11px] text-foreground">{{ permission.label }}</span>
          </div>
        </div>
      </div>
      <p v-if="groupedPermissions.length === 0" class="text-xs text-muted-foreground">
        需要相应权限才能查看权限目录。
      </p>
    </div>
  </Card>
</AdminPage>
`
});
