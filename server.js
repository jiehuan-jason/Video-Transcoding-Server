const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

// 存储任务队列
let taskQueue = [];

app.use(cors());
app.use(express.json()); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true })); // 解析 URL 编码的请求体

// 获取视频下载链接
async function fetchVideoInfo(bvid) {
  try {
    // 获取 CID
    const cidResponse = await axios.get(`https://api.bilibili.com/x/player/pagelist`, {
      params: { bvid }
    });
    const cid = cidResponse.data.data[0]?.cid;
    if (!cid) throw new Error('无法获取视频 CID');

    // 获取播放链接
    const playResponse = await axios.get(`https://api.bilibili.com/x/player/playurl`, {
      params: { bvid, cid, qn: 6, platform: 'html5', high_quality: 1 }
    });

    const videoUrl = playResponse.data.data.durl[0]?.url;
    if (!videoUrl) throw new Error('无法获取视频下载地址');

    return { cid, videoUrl };
  } catch (error) {
    console.error(`获取视频信息失败: ${error.message}`);
    throw new Error('获取视频信息失败');
  }
}

// 添加下载任务
app.get('/api/download', async (req, res) => {
  const { bvid } = req.query;
  if (!bvid) return res.status(400).json({ message: '缺少 BVID 参数' });

  try {
    if(taskQueue.some(t => t.taskId === bvid)){
      return res.json({ code: 12 });
    }
    const { videoUrl } = await fetchVideoInfo(bvid);

    const taskId = bvid;
    const outputFilePath = `output/${taskId}_240p.mp4`;
    console.log(`任务已添加： ${bvid}`)
    // 将任务添加到队列
    taskQueue.push({
      taskId,
      bvid,
      videoUrl,
      outputFilePath,
      status: 'queued'
    });

    res.json({ code: 1, taskId });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 查询任务状态
app.get('/api/status', (req, res) => {
  const { taskId } = req.query;

  const task = taskQueue.find(t => t.taskId === taskId);
  if (!task) return res.status(404).json({ message: '任务未找到' });
  if (task.status === 'completed') {
    return res.json({ code: 0, downloadLink: `/api/output/${taskId}_240p.mp4` });
  } else if (task.status === 'queued') {
    const queueLength = taskQueue.filter(t => t.status === 'queued' && t.taskId !== taskId).length + 1;
    return res.json({ code: 11, queueLength });
  } else {
    return res.json({ code: 10 }); // 处理中
  }
});

// 下载已转码的视频
app.get('/api/output/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'output', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('视频文件未找到');
  res.download(filePath);
});

// 处理任务队列
async function processQueue() {
  const currentTask = taskQueue.find(t => t.status === 'queued');
  if (!currentTask) return; // 没有任务需要处理

  currentTask.status = 'processing';

  try {
    console.log(`开始处理任务: ${currentTask.taskId}`);
    
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // 下载视频
    const tempFilePath = path.join(__dirname, 'temp', `${currentTask.taskId}.mp4`);
    if (!fs.existsSync(path.dirname(tempFilePath))) {
      fs.mkdirSync(path.dirname(tempFilePath));
    }

    const writer = fs.createWriteStream(tempFilePath);
    const response = await axios.get(currentTask.videoUrl, { responseType: 'stream' });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 转码视频
    console.log(`任务 ${currentTask.taskId} 下载完成，开始转码`);
    await new Promise((resolve, reject) => {
      ffmpeg(tempFilePath)
        .output(currentTask.outputFilePath)
        .videoCodec('libx264')
        .size('426x240') // 转为 240p
        .audioCodec('aac')
        .audioBitrate('128k')
        .on('end', () => {
          currentTask.status = 'completed';
          console.log(`任务 ${currentTask.taskId} 转码完成`);
          fs.unlinkSync(tempFilePath); // 删除临时文件
          resolve();
        })
        .on('error', err => {
          currentTask.status = 'error';
          console.error(`任务 ${currentTask.taskId} 转码失败: ${err.message}`);
          fs.unlinkSync(tempFilePath); // 删除临时文件
          reject(err);
        })
        .run();
    });

  } catch (error) {
    currentTask.status = 'error';
    console.error(`任务 ${currentTask.taskId} 下载或转码失败: ${error.message}`);
  }
}

// 每秒处理队列中的任务
let processing = false;

setInterval(async () => {
  if (processing) return; // 如果当前有任务正在处理，直接返回
  processing = true;
  await processQueue();
  processing = false;
}, 1000);

// 每日 24 点清理任务队列和文件
function resetQueue() {
  taskQueue = [];
  const outputDir = path.join(__dirname, 'output');
  const tempDir = path.join(__dirname, 'temp');

  [outputDir, tempDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => fs.unlinkSync(path.join(dir, file)));
    }
  });

  console.log('每日清理完成：队列及文件已重置');
}

// 每天 00:00 重置
setInterval(resetQueue, 24 * 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`服务器已启动: http://localhost:${port}`);
});
