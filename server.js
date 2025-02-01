const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 4000;

// 存储任务队列
let taskQueue = [];

app.use(cors());
app.use(express.json()); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true })); // 解析 URL 编码的请求体




// 获取视频下载链接
async function fetchVideoInfo(bvid, cid = null) {
  try {
    // 如果没有提供 cid，则根据 bvid 获取 CID 列表
    if (!cid) {
      const cidResponse = await axios.get(`https://api.bilibili.com/x/player/pagelist`, {
        params: { bvid }
      });

      const firstPageData = cidResponse.data.data[0];
      if (!firstPageData) throw new Error('无法获取任何页面的 CID');
      cid = firstPageData.cid;
    }

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
  const { bvid, cid } = req.query;
  if (!bvid) return res.status(400).json({ message: '缺少 BVID 参数' });

  try {
    // 使用 cid 参数，若未提供则获取
    const { cid: videoCid, videoUrl } = await fetchVideoInfo(bvid, cid);

    if (taskQueue.some(t => t.taskId === videoCid)) {
      return res.json({ code: 12 });
    }

    const taskId = videoCid;
    const outputFilePath = `output/${taskId}_240p.mp4`;
    console.log(`任务已添加： ${bvid}`);

    // 将任务添加到队列
    taskQueue.push({
      taskId,
      bvid,
      cid: videoCid,
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
  console.log('开始执行每日清理...');

  // 分离已完成和未完成的任务
  const completedTasks = taskQueue.filter(t => t.status === 'completed');
  const remainingTasks = taskQueue.filter(t => t.status !== 'completed');

  // 更新任务队列，只保留未完成的任务
  taskQueue = remainingTasks;

  // 清理已完成任务的文件
  completedTasks.forEach(task => {
    try {
      // 删除输出文件
      const outputFile = path.join(__dirname, 'output', `${task.taskId}_240p.mp4`);
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
        console.log(`已删除完成任务的输出文件: ${outputFile}`);
      }

      // 清理可能残留的临时文件（正常情况下转码完成时已删除）
      const tempFile = path.join(__dirname, 'temp', `${task.taskId}.mp4`);
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log(`已删除残留的临时文件: ${tempFile}`);
      }
    } catch (err) {
      console.error(`清理任务 ${task.taskId} 文件时出错:`, err);
    }
  });

  // 记录清理结果
  console.log(`每日清理完成：
    已清理完成的任务数: ${completedTasks.length}
    剩余未完成任务数: ${remainingTasks.length}
    当前队列状态: ${remainingTasks.map(t => `${t.taskId}(${t.status})`).join(', ')}`);
}

// 每天 00:00 重置
setInterval(resetQueue, 24 * 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`服务器已启动: http://localhost:${port}`);
});
