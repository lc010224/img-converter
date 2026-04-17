# 图片格式转换控制台

这是一个可直接部署在 OVH 服务器（Debian 12）上的单容器 Docker Compose 项目。

现在项目已经改成：

- 使用 GitHub Container Registry 公共镜像发布
- `docker-compose.yml` 直接使用 `image: ghcr.io/lc010224/img-converter:latest`
- 服务器部署和更新都通过拉取镜像完成
- 一个容器同时提供前端页面和后端 API
- 只挂载一个宿主机数据目录到容器 `/data`
- 前端可以在 `/data` 下自由选择任意子文件夹作为源目录和输出目录

## 当前 compose 形式

```yaml
services:
  img-converter:
    image: ghcr.io/lc010224/img-converter:latest
    container_name: img-converter
    restart: unless-stopped
    ports:
      - "3115:7745"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - /home/img-converter/data:/data
```

## 镜像发布方式

仓库已配置 GitHub Actions：

- 当代码推送到 `main` 分支时
- 会自动构建 Docker 镜像
- 自动推送到 GitHub Container Registry

发布地址为：

```text
ghcr.io/lc010224/img-converter:latest
```

此外也会生成一个带提交哈希的标签，便于精确版本追踪。

## `latest` 是怎么工作的

`latest` 只是一个镜像标签，不代表自动更新。

它的真实含义是：

- 仓库每次发布最新镜像时，会覆盖 `latest` 标签
- 服务器如果想用最新版本，需要重新拉取这个标签

所以服务器更新流程是：

```bash
sudo docker compose pull
sudo docker compose up -d
```

## 以后你修改功能后如何更新镜像

流程如下：

1. 你在本地修改代码
2. 提交并推送到 GitHub `main`
3. GitHub Actions 自动构建并推送新镜像到 `ghcr.io`
4. 服务器执行：

```bash
sudo docker compose pull
sudo docker compose up -d
```

这样服务器就会更新到新的 `latest` 镜像。

## GitHub Actions 工作流

仓库已新增工作流文件：

```text
.github/workflows/publish-ghcr.yml
```

它会自动：

- 登录 `ghcr.io`
- 构建镜像
- 推送 `latest`
- 推送 `sha-*` 标签

## OVH Debian 12 安装方式

先在服务器上安装 Docker 与 Docker Compose 插件：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
```

## 服务器部署方式

### 1. 创建项目目录

```bash
sudo mkdir -p /opt/image-converter
cd /opt/image-converter
```

### 2. 创建数据目录

```bash
sudo mkdir -p /home/img-converter/data
```

你可以在这个目录下自由建立任意层级的子目录，例如：

```bash
sudo mkdir -p /home/img-converter/data/raw/2025/album-a
sudo mkdir -p /home/img-converter/data/raw/2025/album-b
sudo mkdir -p /home/img-converter/data/converted/webp
sudo mkdir -p /home/img-converter/data/converted/jpeg
```

### 3. 创建 `docker-compose.yml`

把下面内容保存到服务器 `/opt/image-converter/docker-compose.yml`：

```yaml
services:
  img-converter:
    image: ghcr.io/lc010224/img-converter:latest
    container_name: img-converter
    restart: unless-stopped
    ports:
      - "3115:7745"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - /home/img-converter/data:/data
```

### 4. 启动服务

```bash
sudo docker compose up -d
```

### 5. 访问页面

```text
http://你的服务器IP:3115
```

## 服务器更新方式

以后每次镜像发布后，服务器上执行：

```bash
cd /opt/image-converter
sudo docker compose pull
sudo docker compose up -d
```

如果你想确认镜像是否已经更新，也可以先执行：

```bash
sudo docker compose pull
sudo docker images | grep img-converter
```

## 本地开发与发布流程

### 1. 修改代码

在本地修改项目代码。

### 2. 提交并推送

```bash
git add .
git commit -m "feat: your change"
git push
```

### 3. GitHub 自动发布镜像

推送到 `main` 后，GitHub 会自动执行工作流并发布新镜像。

### 4. 服务器拉取更新

```bash
sudo docker compose pull
sudo docker compose up -d
```

## 目录映射规则

宿主机：

```text
/home/img-converter/data
```

容器内：

```text
/data
```

例如宿主机目录：

```text
/home/img-converter/data/raw/2025/album-a
```

前端里看到的是：

```text
/data/raw/2025/album-a
```

## 注意事项

- 如果 GitHub Actions 首次推送镜像失败，通常需要确认仓库 Actions 和 Packages 权限是否正常。
- 如果 GHCR 包默认不是 public，需要在 GitHub Packages 页面把包可见性改成 public。
- `latest` 不会自动下发到服务器，服务器必须手动 `pull`。
- 转成 `webp` 时使用 `cwebp`。
- 转成 `jpeg` / `png` 时使用 Pillow。

## 当前仓库

```text
https://github.com/lc010224/img-converter.git
```

## 当前镜像

```text
ghcr.io/lc010224/img-converter:latest
```
