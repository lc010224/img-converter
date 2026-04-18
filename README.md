# 图片格式转换


## 服务器部署方式


### 创建 `docker-compose.yml`

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
      - /home/img-converter/data:/data  # 待转换的vps服务器的图片的路径
      - /home/img-converter/local-temp:/local-temp   # 笔记本等本地设备上的图片转换时，上传到vps服务器的临时保存目录，文件转换完下载后自动删除

```

### 启动服务

```bash
sudo docker compose up -d
```

### 访问页面

```text
http://你的服务器IP:3115
```
