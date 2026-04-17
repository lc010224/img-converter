# 图片格式转换控制台

这是一个可直接部署在 OVH 服务器（Debian 12）上的单容器 Docker Compose 项目。

现在已经改成你更喜欢的这种形式：

- `compose` 里只有一个服务
- 一个容器同时提供前端页面和后端 API
- 只挂载一个宿主机数据目录到容器 `/data`
- 前端可以在 `/data` 下自由选择任意子文件夹作为源目录和目标目录

## 当前 compose 形式

```yaml
services:
  img-converter:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: img-converter
    restart: unless-stopped
    ports:
      - "3115:7745"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - /home/img-converter/data:/data
```

这已经非常接近你给的 `homebox` 示例风格。

## 为什么我这里不是直接写 `image: xxx:latest`

因为你这个项目当前是**本地源码构建**方式，不是已经发布好的公共镜像。

也就是说，现在用的是：

```yaml
build:
  context: .
  dockerfile: backend/Dockerfile
```

含义是：

- 直接用你本地项目源码构建镜像
- 每次你改了代码，都可以重新构建
- 不依赖远程镜像仓库

这很适合你当前开发阶段。

## `latest` 标签的镜像是什么意思

像你给的这个：

```yaml
image: ghcr.io/sysadminsmedia/homebox:latest
```

含义是：

- `ghcr.io/sysadminsmedia/homebox` 是镜像仓库地址
- `latest` 是镜像标签
- Compose 启动时会拉取这个远程镜像来运行

但要注意：

- `latest` 不是“自动更新”
- `latest` 只是一个标签名
- 只有镜像仓库里有人重新推送了新的 `latest`，你重新拉取，容器才会用到新版本

## 你这个项目以后可以用 `latest` 吗

可以，但前提是：

1. 你要先把镜像发布到 Docker Hub 或 GitHub Container Registry
2. 每次你更新代码后，要重新构建并推送镜像
3. 然后服务器再 `pull` 新镜像并重启容器

也就是说，可以做到，但要多一步“发布镜像”。

## 你现在这种项目，更新最简单的方式

因为你现在是源码 + compose 构建模式，所以更新最简单：

### 本地改完并提交后

如果服务器上也是这个项目源码目录，直接执行：

```bash
cd /opt/image-converter
sudo docker compose up -d --build
```

这会：

- 重新读取最新代码
- 重新构建镜像
- 用新镜像重建容器

这就是你当前最适合的更新方式。

## 如果以后你想改成 `image: yourname/img-converter:latest`

你可以这样做。

### compose 写法会变成

```yaml
services:
  img-converter:
    image: yourname/img-converter:latest
    container_name: img-converter
    restart: unless-stopped
    ports:
      - "3115:7745"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - /home/img-converter/data:/data
```

### 你本地每次发版时

构建并推送镜像：

```bash
docker build -f backend/Dockerfile -t yourname/img-converter:latest .
docker push yourname/img-converter:latest
```

### 服务器更新时

```bash
sudo docker compose pull
sudo docker compose up -d
```

## 两种更新方式区别

### 方式 1：源码构建型

compose：

```yaml
build:
  context: .
  dockerfile: backend/Dockerfile
```

更新方式：

```bash
sudo docker compose up -d --build
```

优点：

- 简单
- 不需要镜像仓库
- 非常适合你现在这种个人项目

缺点：

- 服务器本机要参与构建

### 方式 2：远程镜像型

compose：

```yaml
image: yourname/img-converter:latest
```

更新方式：

```bash
sudo docker compose pull
sudo docker compose up -d
```

优点：

- 服务器更新更标准
- 多台机器部署方便

缺点：

- 你需要维护镜像仓库
- 每次改代码都要 build + push 镜像

## 建议

对你现在这个项目，我建议：

- 目前先继续用 `build` 模式
- 因为你还在开发和频繁修改功能
- 等功能稳定后，我再帮你加 GitHub Actions 自动构建镜像并推送 `latest`

那时你就可以真的使用：

```yaml
image: ghcr.io/lc010224/img-converter:latest
```

## 部署方式

### 1. 准备数据目录

```bash
sudo mkdir -p /home/img-converter/data
```

### 2. 上传项目

```bash
scp -r 图片格式转换 user@your-server-ip:/opt/image-converter
```

### 3. 启动

```bash
cd /opt/image-converter
sudo docker compose up -d --build
```

### 4. 访问

```text
http://你的服务器IP:3115
```

## 当前仓库

```text
https://github.com/lc010224/img-converter.git
```
