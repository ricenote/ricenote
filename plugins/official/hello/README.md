# rice.hello —— Hello 示例插件

用于**演示与验证**插件 API 的最小示例：它同时用到服务发布、公开路由、事件订阅与后台菜单，
但不持有数据表、不依赖任何插件 —— 适合作为你自己写第一个插件时的参照。

## 清单摘要

| 项 | 值 |
| --- | --- |
| id | `rice.hello` |
| version | `1.0.0` |
| apiVersion | `^1.0.0` |
| entry | `./dist/index.js` |
| provides | `demo.hello@1` |
| requires | 无 |
| capabilities | `routes:public`、`services:provide`、`events:publish`、`events:subscribe`、`admin:menu` |
| migrations | 无 |
| 数据表 | 无 |

## 扩展点（Hook）

### 公开路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/hello` | 返回 JSON：插件 id、版本、启动时间与问候语（支持 `?name=`） |

```bash
curl 'http://localhost:3000/hello?name=RiceNote'
```

### 服务契约（提供）

`demo.hello@1`：

```ts
interface HelloService {
  greet(name: string): string;
  startedAt: string;   // ISO 8601
}
```

### 事件

- 订阅 `core.hello.ping.v1`：收到后写一条 info 日志（用于演示事件通道与请求 ID 透传）。

### 后台菜单

`{ id: 'demo.hello', label: 'Hello 示例', path: '/hello', icon: 'Sparkles', order: -10, permission: 'plugin.view' }`

> `path` 指向的是**前台**路径而非后台页面，因此左侧导航会退化为普通链接；
> 这正好演示了"插件可以是任意 path，后台未注册路由时降级为普通链接"的防御行为。

## 设置项

无。

## 一个最小插件的完整结构

```
plugins/official/hello/
├── manifest.json     # 必须：id / version / apiVersion / entry + 能力声明
├── package.json
├── tsconfig.json
├── README.md
└── src/index.ts      # definePlugin({ start, stop })
```

`start(ctx)` 中做注册，`stop(ctx)` 中**不需要**手动注销 ——
`ctx.*.register/add/provide/on` 返回的句柄由 Core 统一收集并在停用后回收，
停用后残留会被 `assertNoLeaks()` 判为失败。
