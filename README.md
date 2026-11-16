# DSH 火宝短剧桥接插件（dsh-huobao-drama）

把 [火宝短剧](https://github.com/chatfire-AI/huobao-drama) 的后端 HTTP API 桥接成一组的 DSH Agent 工具：项目管理、剧本/分镜拆解、角色/场景/素材、图片/视频生成任务、导入导出与配置查询。

本插件**不内置后端**。火宝短剧是一个 Hono + Drizzle(SQLite) + Mastra 的全栈 TS 应用，需要单独运行它的 backend 服务（默认端口 5679）。本插件只负责把它的能力以工具形式暴露给 DSH 里的大模型。

## 致谢与声明

- 本插件的后端能力来自开源项目 [火宝短剧（chatfire-AI/huobao-drama）](https://github.com/chatfire-AI/huobao-drama)，在此向原作者及所有贡献者致以诚挚感谢；正是他们的开源工作让本项目成为可能。
- 本项目是一个**非官方**的第三方桥接/封装插件，与火宝短剧官方团队无隶属、赞助或背书关系。
- 火宝短剧相关的代码、名称、商标及文档版权归原权利人所有，并遵循其原仓库声明的开源许可证。本项目仅作技术集成与便利化使用，不主张任何所有权；如涉及侵权或授权问题，请联系处理。

## 侧栏面板

插件提供一个 DSH 侧栏入口「火宝短剧」，点击后在主区域以面板（iframe）嵌入火宝完整 Web UI（默认 `http://127.0.0.1:5679/`）。这是官方界面的嵌入展示，功能与直接用浏览器打开一致；前端页面同样来自上述官方项目。

## 安装

在 DSH 配置文件的 profile 里：

1. `dsh.profile.bundles` 加入 `"dsh-huobao-drama"`
2. `dependencies` 加入 `"dsh-huobao-drama": "link:E:/DshConfig/dsh-huobao-drama"`（link 表示直接读源码，改代码即时生效）

工具注册型插件必须在 profile 里声明并**完整重启 DSH**（仅刷新网页无效）。

## 配置

在插件配置（`plugins.bundle.config`，key = `dsh-huobao-drama`）里可设置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:5679` | 火宝后端地址 |
| `apiPrefix` | `/api/v1` | API 前缀；后端若改了前缀在这里同步 |
| `timeoutMs` | `60000` | 单次请求超时（图片/视频生成可按需调大） |

## 启动后端

```bash
cd <huobao-drama>/backend
npm install
npm run dev      # 默认监听 5679，数据写在仓库 data/huobao.sqlite3
```

验证：`curl http://127.0.0.1:5679/api/v1/health` 应返回 `{"status":"ok",...}`。

## 工具集

安装后可用工具以 `huobao_` 前缀命名，覆盖了后端 `/api/v1/*` 的主要资源与动作。所有工具返回的是**拆过信封的可读结果**（后端的 `{code,data,message}` 信封会被拆开，错误变成人话），不含裸数据结构。

## 说明

- 后端 AI 模型配置存在它自己的 SQLite 表 `ai_service_configs` 里，不在本插件中；请用 `huobao_list_models_and_configs` 一类工具或在火宝前端里配置。
- 视频/图片生成是异步任务，用 `huobao_generate_task` 提交、`huobao_get_task_status` 轮询。
