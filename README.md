# 锦鉴 · 面料样品管理与以图检索

锦鉴（Fabric Sample）是一套面向纺织企业的面料样品管理系统，支持集中管理样品图片与业务参数，并通过上传图片查找相似面料。

## 系统功能

- **样品管理**：创建、编辑、搜索和删除样品，管理编号、名称及业务参数。
- **图片管理**：每个样品支持 1–12 张图片，可预览、追加和删除。
- **自定义字段**：支持文本、数字、下拉选项，可配置必填、排序与结果展示。
- **以图搜样品**：接入百度智能云面料检索，支持灰度纹理搜索、相关度筛选与样品去重。
- **图库同步**：支持图片入库、删除及失败后的手动重试。
- **本地演示**：无需百度密钥即可体验样品管理与本地图片匹配。

## 技术栈

| 层级           | 技术                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 前端           | React 19、TypeScript、Vite、Ant Design、React Router、TanStack Query |
| 后端           | Node.js 24、NestJS、Prisma                                           |
| 数据库         | PostgreSQL                                                           |
| 图片处理与检索 | Sharp、百度智能云图像搜索 API                                        |
| 部署           | Docker Compose 或 Node.js 直接运行                                   |

## 环境变量配置

按运行方式复制对应的配置示例，并编辑生成的文件：

```sh
# 本地开发或 Node.js 部署
cp server/.env.example server/.env

# Docker Compose 部署
cp .env.example .env
```

| 配置项                                            | 说明                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                                    | 本地后端的 PostgreSQL 连接串；Docker 部署时自动生成  |
| `POSTGRES_PASSWORD`                               | Docker 数据库密码，需替换为长随机字母数字密码        |
| `SEARCH_MODE`                                     | `demo` 为本地演示，`baidu` 为真实检索                |
| `BAIDU_AUTH_MODE`                                 | `oauth` 使用应用密钥；`aksk` 使用 AccessKey          |
| `BAIDU_API_KEY` / `BAIDU_SECRET_KEY`              | OAuth 模式的百度应用密钥                             |
| `BAIDU_ACCESS_KEY_ID` / `BAIDU_ACCESS_KEY_SECRET` | AK/SK 模式的百度凭据                                 |
| `BAIDU_SEARCH_TYPE`                               | 面料图库使用 `materiel`                              |
| `HOST` / `PORT`                                   | 本地后端监听地址与端口，默认 `127.0.0.1:3001`        |
| `STORAGE_DIR`                                     | 本地图片存储目录，默认 `server/data/uploads/`        |
| `CORS_ORIGIN`                                     | 本地开发允许的前端来源，默认 `http://127.0.0.1:5173` |

示例默认使用 `demo`。真实检索需先在百度智能云开通面料图片搜索图库，设置 `SEARCH_MODE=baidu` 并填写对应凭据，修改后重启应用。真实配置文件已被 Git 忽略，请勿提交密钥。

## 开发启动

需要 **Node.js 24 和 npm**。在项目根目录执行：

```sh
npm ci
cp server/.env.example server/.env
npm run db:generate
```

在一个终端启动本地开发数据库，保持终端运行：

```sh
npm run db:local
```

在另一个终端初始化数据库并启动应用：

```sh
npm run db:push
npm run dev
```

访问 [http://127.0.0.1:5173](http://127.0.0.1:5173)。已有 PostgreSQL 时，修改 `DATABASE_URL` 并跳过 `db:local`。需要演示数据时，应用启动后可执行 `npm run seed:demo`。

## 部署

### Docker Compose

需要 Docker 与 Docker Compose v2，在项目根目录执行：

```sh
cp .env.example .env
# 编辑 .env，设置数据库密码和检索配置

docker compose up --build -d
```

访问 [http://127.0.0.1:3001](http://127.0.0.1:3001)。数据库和图片通过 Docker 卷持久化。更新后重新执行启动命令；停止服务使用 `docker compose down`，添加 `-v` 会删除数据卷。

### Node.js 部署

准备 Node.js 24 和 PostgreSQL，在项目根目录执行：

```sh
npm ci
cp server/.env.example server/.env
# 编辑 server/.env，配置实际数据库和检索凭据

npm run db:generate
npm run db:push
npm run build
npm start
```

访问 [http://127.0.0.1:3001](http://127.0.0.1:3001)，后端同时提供前端页面与 API。

当前版本未包含登录与权限控制，部署默认仅监听本机；正式使用时需配置访问控制、域名和 HTTPS，并备份数据库与图片。百度检索会将灰度图片发送至百度云，第三方服务费用另计。

## 关于我们

**绍兴风禾信息科技有限公司（风禾科技）** 聚焦 **企业数字化与企业 AI 落地**，提供业务系统、Web 应用、数据可视化、企业知识库、AI 智能助手、智能体及工作流自动化开发，也支持为现有业务系统接入 AI 能力。

我们提供以下服务：

- **私有化部署**：在企业自有服务器或指定云环境部署应用，提供上线与运维支持。
- **定制开发**：按业务需要扩展功能、调整流程与界面。
- **系统集成**：对接 ERP、库存、样品管理等业务系统。
- **企业 AI 落地**：结合企业数据与流程，定制智能检索、知识问答和自动化应用。

部署实施、定制开发及技术支持按需求另行报价。当前检索依赖百度云，完全内网检索可另行定制。

官网：[https://www.efhkj.com](https://www.efhkj.com)

## 开源协议

本项目采用 **GNU GPLv3（GPL-3.0-only）**，允许使用、修改及遵守许可的商业使用；分发软件或修改版时，须按协议提供相应源码并保留版权与许可声明。完整条款见 [LICENSE](LICENSE)。

Copyright (C) 2026 绍兴风禾信息科技有限公司及其他贡献者。
