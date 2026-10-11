/**
 * 后台认证门面。
 *
 * 会话状态（当前用户、权限、CSRF Token）由 `@ricenote/admin-sdk` 持有 ——
 * 插件后台界面同样要读当前登录者与权限，因此状态必须是全局单例；
 * 这里只提供后台页面习惯的 `useAuth` 名字，避免出现第二份状态。
 */

export { useSession as useAuth } from '@ricenote/admin-sdk';
