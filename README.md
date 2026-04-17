# 图片格式转换控制台

这是一个可直接部署在 OVH 服务器（Debian 12）上的 Docker Compose 项目，提供：

- 前端：可视化目录浏览与图片转换配置
- 后端：执行图片格式转换 API
- 后端镜像内自动安装 `cwebp` 和 `inotify-tools`
- Compose 只挂载一个宿主机数据目录到容器 `/data`
- 前端可直接选择 `/data` 下任意子文件夹作为源目录和输出目录

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

## 当前实现方式

现在 `docker-compose.yml` 只挂载一个宿主机数据根目录：

- `${HOST_DATA_DIR:-/opt/image-converter-data}` -> `/data`

这样前端和后端都只围绕 `/data` 工作：

- 源目录必须从 `/data` 下选择
- 输出目录必须从 `/data` 下选择
- 后端拒绝访问 `/data` 之外的路径

这比挂载整个服务器根目录更安全，也更符合你要的“在数据目录下自由选任意文件夹”的需求。

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

```bash
scp -r 图片格式转换 user@your-server-ip:/opt/image-converter
```

### 2. 准备数据目录

```bash
sudo mkdir -p /opt/image-converter-data
```

你可以在这个目录下自由建立任意层级的子目录，例如：

```bash
sudo mkdir -p /opt/image-converter-data/raw/2025/album-a
sudo mkdir -p /opt/image-converter-data/raw/2025/album-b
sudo mkdir -p /opt/image-converter-data/converted/webp
sudo mkdir -p /opt/image-converter-data/converted/jpeg
```

### 3. 进入项目目录

```bash
cd /opt/image-converter
```

### 4. 启动服务

如果使用默认目录：

```bash
sudo docker compose up -d --build
```

如果要自定义宿主机数据目录：

```bash
HOST_DATA_DIR=/your/data/root sudo -E docker compose up -d --build
```

### 5. 打开前端页面

```text
http://你的服务器IP:8080
```

后端接口默认地址：

```text
http://你的服务器IP:8000
```

## 使用说明

1. 打开前端页面
2. 在“源图片目录”区域中浏览 `/data` 下的目录结构
3. 进入任意子目录后，点击“选中”作为待转换目录
4. 在“输出目录”区域中浏览 `/data` 下的目录结构
5. 进入任意子目录后，点击“选中”作为输出目录
6. 设置目标格式、质量、输入格式、是否删除原图
7. 点击“开始转换”

## 目录选择规则

- 前端只能浏览 `/data` 下的目录
- 后端也只接受 `/data` 下的路径
- 这样可以避免用户误操作到服务器其他系统目录
- 你可以在宿主机数据目录下提前创建任意业务目录结构，前端会直接显示这些子目录

## 示例目录映射关系

如果宿主机目录是：

```text
/opt/image-converter-data/raw/2025/album-a
```

那么前端里看到并选择的路径会是：

```text
/data/raw/2025/album-a
```

如果宿主机输出目录是：

```text
/opt/image-converter-data/converted/webp
```

那么前端里选择的输出路径会是：

```text
/data/converted/webp
```

## 运行检查

```bash
sudo docker compose ps
sudo docker compose logs -f backend
sudo docker compose logs -f frontend
curl http://127.0.0.1:8000/health
```

还可以测试目录浏览接口：

```bash
curl "http://127.0.0.1:8000/folders?path=/data"
```

## 注意事项

- 如果某个子目录没有出现在前端，先确认它确实存在于宿主机数据目录下。
- 输出目录如果不存在，后端在转换时会自动创建。
- 转成 `webp` 时使用 `cwebp`。
- 转成 `jpeg` / `png` 时使用 Pillow。
- 当前项目仓库：

```text
https://github.com/lc010224/img-converter.git
```
