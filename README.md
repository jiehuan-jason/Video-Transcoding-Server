# Video Transcoding Server

将上传的视频转码为240p AAC_LC伴音，20min的视频转码后大小约为50MB

## 测试环境

Nginx v1.23.3

Node.js v20.17.0



## 使用前配置

 请在server.js里配置好端口，并在index.html中输入server的ip（域名）和端口，如果在同一机器上请**不要**使用localhost或127.0.0.1

使用nodejs启动server，并把index.html放到你的服务器目录内（如apache和nginx），然后Enjoy it！

## API参数

### 1. `/api/download`

**请求方式**: `GET`  
**参数**:

- `bvid`: [必选] 视频的 BVID
- `cid`: [可选] 视频页面的 CID。如果未提供，系统将根据 BVID 获取 CID

**返回值**:

```JSON
{
  "code": 1, // 任务已添加，返回任务 ID
  "taskId": "videoCid" // 视频的 CID
}
```

**返回代码解释**:

- `code: 1` - 任务已成功添加到队列
- `code: 12` - 当前视频任务已经在队列中

---

### 2. `/api/status`

**请求方式**: `GET`  
**参数**:

- `taskId`: [必选] 任务 ID（对应下载任务的 CID）

**返回值**:

```json
{
  "code": 0, // 转码完成，返回下载链接
  "downloadLink": "/api/output/{taskId}_240p.mp4"
}
```

或

```json
{
  "code": 11, // 任务在队列中，返回队列长度
  "queueLength": 2 // 当前任务排在队列中的位置
}
```

或

```json
{
  "code": 10 // 任务正在处理中
}
```

**返回代码解释**:

- `code: 0` - 任务已完成转码，返回下载链接
- `code: 10` - 任务正在处理中
- `code: 11` - 任务在队列中，返回当前任务的排队位置

---

### 3. `/api/output/:filename`

**请求方式**: `GET`  
**参数**:

- `filename`: [必选] 下载文件的文件名，格式为 `{taskId}_240p.mp4`

**返回值**:

- 返回下载的 `.mp4` 文件

**返回代码解释**:

- `200 OK` - 文件存在并返回
- `404 Not Found` - 文件未找到

## 版权 CopyRight

©2024 Project Kinsler and Jason Wang.
