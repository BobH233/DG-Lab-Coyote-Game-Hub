<h1 align="center"> 战败惩罚——郊狼游戏控制器</h1>
<div align="center">
  <a href="https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/actions"><img src="https://img.shields.io/github/actions/workflow/status/hyperzlib/DG-Lab-Coyote-Game-Hub/node.js.yml"></a>
  <a href="https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/releases"><img src="https://img.shields.io/github/release-date/hyperzlib/DG-Lab-Coyote-Game-Hub"></a>
  <a href="https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/commits/main/"><img src="https://img.shields.io/github/last-commit/hyperzlib/DG-Lab-Coyote-Game-Hub"></a>
</div>
<p></p>
<div align="center">
  <a href="https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/actions">下载</a>
  |
  <a href="https://www.bilibili.com/video/BV17m421G7fm/">预览</a>
  |
  <a href="docs/api.md">插件API</a>
</div>
<p></p>
<div align="center">
  <img src="docs/images/screenshot-widget.png" height="200" alt="小组件截图">
</div>

## 注意事项

请遵守直播平台的相关规定，不要违规使用本组件，如果使用本组件造成直播间封禁等后果与本组件作者无关。

## 使用方法（Windows二进制发行版）

1. 从 [Releases](https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/releases) 下载 ```coyote-game-hub-windows-amd64-dist.zip```：[点击跳转](https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/releases)
2. 解压后运行```start.bat```启动服务器

## 使用方法（Linux/MacOS命令行）
1. 安装nodejs（linux推荐使用nvm，mac使用 ```brew install node@22```)
2. 从 [Releases](https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/releases) 下载 ```coyote-game-hub-nodejs-server.zip```：[点击跳转](https://github.com/hyperzlib/DG-Lab-Coyote-Game-Hub/releases)
3. 在解压后的路径中执行 ```node server/index.js```

## 使用方法（编译使用）

（以下样例中使用了```pnpm```安装依赖，你也可以使用```npm```或者```yarn```）

1. 进入```server```目录，运行```pnpm install```安装依赖

2. 进入```frontend```目录，运行```pnpm install```安装依赖

3. 在项目根目录运行```pnpm install```安装依赖，运行```npm run build```编译项目

4. 在项目根目录运行```npm start```启动服务器

5. 浏览器打开```http://localhost:8920```，即可看到控制面板

## 使用方法（Docker）

1. 在项目根目录构建镜像：
```bash
docker build -t coyote-game-hub .
```

2. 直接运行：
```bash
docker run --name coyote-game-hub \
  -p 8920:8920 \
  -v $(pwd)/docker-data:/app/server/data \
  coyote-game-hub
```

3. 如果你通过域名和反向代理对外提供服务，建议同时传入公开地址环境变量：
```bash
docker run --name coyote-game-hub \
  -p 8920:8920 \
  -v $(pwd)/docker-data:/app/server/data \
  -e CGH_WEB_BASE_URL=https://example.com \
  -e CGH_WEB_WS_BASE_URL=wss://example.com \
  -e CGH_CLIENT_WS_BASE_URL=wss://example.com \
  -e CGH_API_BASE_HTTP_URL=https://example.com \
  coyote-game-hub
```

容器工作目录是```/app/server```。首次启动时如果没有```config.yaml```，程序会基于```config.example.yaml```自动生成。默认会把SQLite数据库和脉冲数据放在挂载的```/app/server/data```目录中。

## GitHub Actions 自动构建 Docker 镜像

仓库中已提供 [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml)，会在以下场景自动构建并推送镜像到 GitHub Container Registry（GHCR）：

1. 推送到```main```或```master```分支
2. 推送形如```v*```的标签
3. 手动触发```workflow_dispatch```

镜像地址默认是：

```bash
ghcr.io/<你的-github-用户名>/<你的仓库名>
```

例如你的 GitHub 用户名是```bobh```，仓库名保持```DG-Lab-Coyote-Game-Hub```，那么最终镜像会推到：

```bash
ghcr.io/bobh/dg-lab-coyote-game-hub:latest
```

首次使用前请确认：

1. 你的 fork 仓库已启用 GitHub Actions
2. 仓库的 Actions 权限允许```Read and write permissions```
3. 如果你希望别人也能直接拉取镜像，可以把 GHCR 包可见性改成```public```

拉取示例：

```bash
docker pull ghcr.io/<你的-github-用户名>/<你的仓库名>:latest
```

## 项目结构

- ```server```：服务器端代码
- ```frontend```：前端代码
