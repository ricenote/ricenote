/**
 * identity 插件的后台界面（零构建）。
 *
 * 这是一个**纯 ESM 模块**，不经过任何打包：
 * - 依赖全部来自 `/admin-sdk/v1/ricenote-admin.js`（Core 托管，与宿主共用同一份 Vue）；
 * - 组件（AdminPage/Card/Button/DataTable/Dialog/Select/…）已由宿主全局注册，
 *   因此模板里直接写标签即可，无需 import；
 * - `api` 自带 CSRF 与会话 Cookie 处理，路径是 `/api/admin` 之后的相对路径。
 *
 * 迁移前该界面位于 `apps/admin/src/views/UsersView.vue`，行为与文案保持一致：
 * 用户列表（状态、角色、最后登录）、创建用户、管理员**重置他人密码**（二次确认）。
 */

import {
  api,
  computed,
  defineAdminPage,
  formatDateTime,
  onMounted,
  ref,
  useSession,
  useToast
} from '/admin-sdk/v1/ricenote-admin.js';

const PAGE_SIZE = 20;

/** 统一把接口错误转成可读文案（与 Core 页面的处理口径一致）。 */
function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

export default defineAdminPage({
  title: '用户',

  setup() {
    const session = useSession();
    const toast = useToast();
    const canManage = computed(() => session.can('user.manage'));

    const users = ref([]);
    const total = ref(0);
    const page = ref(1);
    const keyword = ref('');
    const loading = ref(false);

    const roles = ref([]);

    const dialogOpen = ref(false);
    const saving = ref(false);
    const form = ref({ username: '', displayName: '', email: '', password: '', role: 'contributor' });

    /* ---------------------------- 管理员重置密码 ---------------------------- */
    const resetOpen = ref(false);
    const resetSaving = ref(false);
    const resetTarget = ref(null);
    const resetForm = ref({ newPassword: '', confirmPassword: '' });

    const columns = [
      { key: 'user', label: '用户' },
      { key: 'roles', label: '角色', width: 'w-48' },
      { key: 'status', label: '状态', width: 'w-28' },
      { key: 'lastLoginAt', label: '最后登录', width: 'w-40', hideBelow: 'lg' },
      { key: 'actions', label: '操作', width: 'w-32' }
    ];

    const roleOptions = computed(() => {
      const list = roles.value.length ? roles.value : [{ name: 'contributor' }];
      return list.map((role) => ({ label: role.name, value: role.name }));
    });

    /** 是否为当前登录者本人（后端刻意拒绝重置自己）。 */
    function isSelf(user) {
      return session.user ? user.id === session.user.id : false;
    }

    async function load() {
      loading.value = true;
      try {
        const query = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) });
        if (keyword.value.trim()) query.set('keyword', keyword.value.trim());
        const response = await api.list(`/users?${query.toString()}`);
        users.value = response.data;
        total.value = response.total;
      } catch (error) {
        toast.error(messageOf(error, '用户列表加载失败'));
      } finally {
        loading.value = false;
      }
    }

    async function loadRoles() {
      try {
        const list = await api.get('/roles');
        roles.value = list.map((item, index) => ({ id: index, name: item.name }));
      } catch {
        roles.value = [];
      }
    }

    function search() {
      page.value = 1;
      void load();
    }

    function changePage(next) {
      page.value = next;
      void load();
    }

    function openCreate() {
      form.value = { username: '', displayName: '', email: '', password: '', role: 'contributor' };
      dialogOpen.value = true;
    }

    async function create() {
      if (!form.value.username.trim() || !form.value.email.trim() || !form.value.password) {
        toast.warning('用户名、邮箱与密码均为必填项');
        return;
      }

      saving.value = true;
      try {
        await api.post('/users', {
          username: form.value.username.trim(),
          displayName: form.value.displayName.trim(),
          email: form.value.email.trim(),
          password: form.value.password,
          role: form.value.role
        });
        toast.success(`用户 ${form.value.username} 已创建`);
        dialogOpen.value = false;
        await load();
      } catch (error) {
        toast.error(messageOf(error, '创建失败'));
      } finally {
        saving.value = false;
      }
    }

    function openReset(user) {
      resetTarget.value = user;
      resetForm.value = { newPassword: '', confirmPassword: '' };
      resetOpen.value = true;
    }

    async function resetPassword() {
      if (!resetTarget.value) return;
      if (!resetForm.value.newPassword) {
        toast.warning('请输入新密码');
        return;
      }
      if (resetForm.value.newPassword !== resetForm.value.confirmPassword) {
        toast.error('两次输入的新密码不一致');
        return;
      }

      resetSaving.value = true;
      try {
        await api.post(`/users/${resetTarget.value.id}/password`, {
          newPassword: resetForm.value.newPassword
        });
        toast.success(`已重置 ${resetTarget.value.username} 的密码，该用户所有会话已失效`);
        resetOpen.value = false;
      } catch (error) {
        toast.error(messageOf(error, '重置失败'));
      } finally {
        resetSaving.value = false;
      }
    }

    onMounted(async () => {
      await Promise.all([load(), loadRoles()]);
    });

    return {
      canManage,
      changePage,
      columns,
      create,
      dialogOpen,
      form,
      formatDateTime,
      isSelf,
      keyword,
      load,
      loading,
      openCreate,
      openReset,
      page,
      resetForm,
      resetOpen,
      resetPassword,
      resetSaving,
      resetTarget,
      roleOptions,
      saving,
      search,
      total,
      users,
      PAGE_SIZE
    };
  },

  template: `
<AdminPage
  title="用户"
  :description="'共 ' + total + ' 个账号 · 由 identity 插件管理，角色分派由 authorization 插件负责'"
>
  <template #actions>
    <Button v-if="canManage" @click="openCreate">
      <Icon name="userplus" />
      新建用户
    </Button>
  </template>

  <template #toolbar>
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative min-w-[14rem] flex-1">
        <Icon name="search" class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-8" placeholder="搜索用户名、昵称或邮箱" @enter="search" />
      </div>
      <Button variant="outline" :loading="loading" @click="search">查询</Button>
    </div>
  </template>

  <DataTable :columns="columns" :rows="users" :loading="loading" row-key="id"
    thead-class="bg-muted/50"
    empty-title="暂无用户，或 identity 插件未启用。">
    <template #cell-user="{ row }">
      <p class="font-medium text-foreground">{{ row.displayName }}</p>
      <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">{{ row.username }} · {{ row.email }}</p>
    </template>

    <template #cell-roles="{ row }">
      <div class="flex flex-wrap gap-1">
        <Badge v-for="role in row.roles" :key="role" variant="default">{{ role }}</Badge>
        <span v-if="row.roles.length === 0" class="text-xs text-muted-foreground">未分配</span>
      </div>
    </template>

    <template #cell-status="{ row }">
      <Badge :variant="row.status === 'active' ? 'success' : 'muted'">
        {{ row.status === 'active' ? '正常' : '已禁用' }}
      </Badge>
    </template>

    <template #cell-lastLoginAt="{ row }">
      <span class="text-xs text-muted-foreground">{{ formatDateTime(row.lastLoginAt) }}</span>
    </template>

    <template #cell-actions="{ row }">
      <Button v-if="canManage && !isSelf(row)" variant="ghost" size="sm" @click="openReset(row)">
        <Icon name="keyround" />
        重置密码
      </Button>
      <span v-else-if="isSelf(row)" class="text-[11px] text-muted-foreground">本人（用「个人资料」改密）</span>
      <span v-else class="text-[11px] text-muted-foreground">—</span>
    </template>
  </DataTable>

  <div v-if="total > PAGE_SIZE" class="px-1">
    <Pagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="changePage" />
  </div>

  <Dialog v-model:open="dialogOpen" title="新建用户"
    description="新用户默认获得所选角色；首个用户会自动成为管理员。" width="sm">
    <div class="flex flex-col gap-4">
      <Field label="用户名" required>
        <Input v-model="form.username" placeholder="需以字母开头，长度 3-64" autocomplete="off" />
      </Field>
      <Field label="显示名">
        <Input v-model="form.displayName" placeholder="留空则与用户名一致" />
      </Field>
      <Field label="邮箱" required>
        <Input v-model="form.email" type="email" placeholder="user@example.com" />
      </Field>
      <Field label="初始密码" required>
        <Input v-model="form.password" type="password" placeholder="至少 8 位，不能为纯数字" />
      </Field>
      <Field label="角色">
        <Select v-model="form.role" :options="roleOptions" />
      </Field>
    </div>

    <template #footer>
      <Button variant="ghost" @click="dialogOpen = false">取消</Button>
      <Button :loading="saving" @click="create">
        <Icon name="plus" />
        创建
      </Button>
    </template>
  </Dialog>

  <Dialog v-model:open="resetOpen" title="重置用户密码"
    :description="resetTarget ? '将重置 ' + resetTarget.displayName + '（' + resetTarget.username + '）的登录密码' : ''"
    width="sm">
    <div class="flex flex-col gap-4">
      <div class="rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
        <p class="text-xs leading-relaxed text-warning">
          该用户所有设备的登录会话都会立即失效，需要重新登录。请通过安全渠道把新密码告知本人。
        </p>
      </div>

      <Field label="新密码" required>
        <Input v-model="resetForm.newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位，不能为纯数字" />
      </Field>
      <Field label="确认新密码" required>
        <Input v-model="resetForm.confirmPassword" type="password" autocomplete="new-password" />
      </Field>
    </div>

    <template #footer>
      <Button variant="ghost" @click="resetOpen = false">取消</Button>
      <Button variant="destructive" :loading="resetSaving" @click="resetPassword">
        <Icon name="keyround" />
        确认重置
      </Button>
    </template>
  </Dialog>
</AdminPage>
`
});
