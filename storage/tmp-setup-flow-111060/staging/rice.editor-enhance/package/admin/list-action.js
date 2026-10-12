/**
 * rice.posts.listActions / rice.pages.listActions —— 列表页「新建」入口（mode: replace）。
 *
 * 为什么是 replace：默认内容只是一个"新建"按钮但**没有图标与快捷键提示**，
 * 我们整体替换成带图标与 `Ctrl/⌘ + Alt + N` 提示的入口；replace 语义保证
 * "停用本插件即回退默认按钮"，提供方不需要为此留开关。
 *
 * 跳转目标由 `props.kind` 决定：文章列表 → `/posts/editor`，页面列表 → `/pages/editor`
 * （两个编辑页由 posts / pages 插件注册，深链与刷新都可用）。
 *
 * 导航用 SDK 的 `navigate()` 而不是直接取 router：宿主在启动时注入了后台内跳转实现
 * （见 apps/admin/src/main.ts 的 setHostContext），插件因此不必依赖宿主路由实现。
 */

import {
  computed,
  defineAdminContribution,
  navigate,
  onBeforeUnmount,
  onMounted
} from '/admin-sdk/v1/ricenote-admin.js';

/** kind → 新建页路径（与 posts / pages 插件注册的后台路由一致）。 */
const CREATE_ROUTES = { post: '/posts/editor', page: '/pages/editor' };
/** 快捷键提示文案：需与 onKeydown 的判定条件保持一致。 */
const SHORTCUT_HINT = 'Ctrl/⌘ + Alt + N';

export default defineAdminContribution({
  name: 'editor-enhance:list-action',

  /* 只消费 kind：据此决定跳到文章还是页面的新建页。 */
  props: ['kind'],

  setup(props) {
    const label = computed(() => (props.kind === 'page' ? '新建页面' : '新建文章'));

    function create() {
      try {
        navigate(props.kind === 'page' ? CREATE_ROUTES.page : CREATE_ROUTES.post);
      } catch (error) {
        // 导航失败不能抛到渲染层（否则列表页的整块动作区被错误边界吞掉）
        console.warn('[editor-enhance] 跳转新建页失败', error);
      }
    }

    function onKeydown(event) {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
      if (event.key !== 'n' && event.key !== 'N') return;
      event.preventDefault();
      create();
    }

    onMounted(() => {
      window.addEventListener('keydown', onKeydown);
    });

    /*
     * 扩展点随页面切换会被卸载；漏解绑就会留下**幽灵监听器** ——
     * 离开列表页后快捷键仍然生效，甚至命中已被卸载的组件闭包（内存泄漏 + 误跳转）。
     */
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
    });

    return { create, label, shortcutHint: SHORTCUT_HINT };
  },

  template: `
<Button @click="create">
  <Icon name="plus" class="h-4 w-4" />
  <span>{{ label }}</span>
  <span class="ml-1 rounded border border-border px-1 py-0.5 text-[11px] font-normal text-muted-foreground">
    {{ shortcutHint }}
  </span>
</Button>
`
});
