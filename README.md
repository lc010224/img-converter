# 图片格式转换控制台

这是一个可直接部署在 OVH 服务器（Debian 12）上的 Docker Compose 项目，提供：

- 前端：可视化表单，配置图片转换任务
- 后端：执行图片格式转换 API
- 后端镜像内自动安装 `cwebp` 和 `inotify-tools`
- 支持设置：
  - 需要转换的服务器本地图片路径
  - 转换后保存路径
  - 输出格式
  - 转换质量
  - 是否删除原图
  - 指定需要处理的原始图片格式

## 项目结构

```text
.
├─ backend/
│  ├─ app/
│  │  └─ main.py
│  ├─ Dockerfile
│  └─ requirements.txt
├─ frontend/
│  ├─ app.js
│  ├─ Dockerfile
│  ├─ index.html
│  └─ styles.css
└─ docker-compose.yml
```

## 功能说明

前端页面中可以设置：

- 源图片目录，例如 `/host/var/www/images/source`
- 输出目录，例如 `/host/var/www/images/output`
- 目标格式：`webp` / `jpeg` / `png`
- 图片质量：1-100
- 需要处理的输入格式：`jpg` / `jpeg` / `png` / `webp`
- 是否在转换成功后删除原图

后端会递归扫描源目录中的文件，并将转换后的结果输出到目标目录，保留相对目录结构。

## 为什么路径前面要加 `/host`

在 `docker-compose.yml` 中，宿主机的根目录 `/` 被挂载进后端容器的 `/host`：

- 宿主机 `/var/www/images/source`
- 容器内对应路径 `/host/var/www/images/source`

因此在前端里填写路径时，应该填写容器可见路径，也就是带 `/host` 前缀的路径。

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

## Docker Compose 部署步骤

### 1. 上传项目到服务器

把整个项目目录上传到 OVH 服务器，例如：

```bash
scp -r 图片格式转换 user@your-server-ip:/opt/image-converter
```

### 2. 进入项目目录

```bash
cd /opt/image-converter
```

### 3. 启动服务

```bash
sudo docker compose up -d --build
```

### 4. 打开前端页面

浏览器访问：

```text
http://你的服务器IP:8080
```

后端接口默认地址：

```text
http://你的服务器IP:8000
```

## 使用说明

1. 打开前端页面
2. 填写源目录，例如：`/host/var/www/images/source`
3. 填写输出目录，例如：`/host/var/www/images/output`
4. 选择目标格式、质量、输入格式
5. 按需勾选“转换成功后删除原图”
6. 点击“开始转换”
7. 页面会显示转换结果 JSON，包括成功数、失败数和具体文件

## 运行检查

查看容器状态：

```bash
sudo docker compose ps
```

查看日志：

```bash
sudo docker compose logs -f backend
sudo docker compose logs -f frontend
```

后端健康检查：

```bash
curl http://127.0.0.1:8000/health
```

如果正常，返回结果中会看到：

- `status: ok`
- `cwebp: true`
- `inotifywait: true`

## 注意事项

- 当前配置把宿主机根目录挂载到了容器 `/host`，使用方便，但权限较高。
- 如果你想更安全，可以把 `docker-compose.yml` 中的卷改成特定目录挂载。
- 如果图片很多，首次转换可能需要一些时间。
- 转成 `webp` 时使用的是 `cwebp`。
- 转成 `jpeg` / `png` 时使用的是 Pillow。

## GitHub 上传

如果你要上传到 GitHub，可以执行：

```bash
git init
git add .
git commit -m "feat: add dockerized image converter app"
git branch -M main
git remote add origin 你的GitHub仓库地址
git push -u origin main
```

如果你把仓库地址和可用认证方式给我，我可以继续帮你把上传步骤准备到位。
