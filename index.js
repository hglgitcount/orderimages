// server/index.js
// 订单图片上传 - 后端 API 服务

// 本地开发时加载 .env，EdgeOne 部署时环境变量由控制台配置
import dotenv from 'dotenv';
try { await dotenv.config(); } catch(e) {}

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import ws from 'ws';

const app = express();

// ==================== 配置 ====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;
const PORT = process.env.PORT || 3000;

// Node.js 20 需要使用 ws 库作为 WebSocket transport（Node.js 22+ 才有原生支持）
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    transport: ws
  }
});

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/api/health') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ==================== 微信登录接口 ====================

// 微信登录：code 换取 openid
app.post('/api/auth/login', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: '缺少登录凭证(code)' });
    }

    // 调用微信官方接口
    const wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: WX_APPID,
        secret: WX_SECRET,
        js_code: code,
        grant_type: 'authorization_code'
      }
    });

    const { openid, errcode, errmsg } = wxRes.data;

    if (errcode) {
      console.error('微信登录失败:', errcode, errmsg);
      return res.status(400).json({ error: `微信登录失败: ${errmsg}` });
    }

    if (!openid) {
      return res.status(400).json({ error: '获取用户信息失败' });
    }

    console.log(`用户登录: openid=${openid.substring(0, 10)}...`);

    res.json({ openid });
  } catch (err) {
    console.error('登录接口错误:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 提交保存接口 ====================

// 提交订单图片数据
// 参数：{ orderNo, openid, images: [{ fileName, mimeType, base64 }] }
app.post('/api/upload/submit', async (req, res) => {
  try {
    const { orderNo, openid, images } = req.body;

    console.log('收到提交请求:', { orderNo, openid: openid?.substring(0, 10), imageCount: images?.length });

    if (!orderNo) {
      return res.status(400).json({ error: '请输入订单号' });
    }
    if (!openid) {
      return res.status(400).json({ error: '用户信息缺失，请重新登录' });
    }
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: '请选择图片' });
    }

    const timestamp = Date.now();
    let successCount = 0;
    const savedImages = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const fileName = img.fileName || `${timestamp}_${i + 1}.jpg`;
      const storagePath = `${openid}/${orderNo}/${fileName}`;

      try {
        // 将 base64 转为 Buffer 并上传到 Supabase Storage
        const base64Data = img.base64.replace(/^data:image\/\w+;base64,/, '');
        const fileBuffer = Buffer.from(base64Data, 'base64');

        console.log(`上传图片${i + 1}: storagePath=${storagePath}, size=${fileBuffer.length}bytes`);

        const { error: uploadErr } = await supabaseAdmin
          .storage
          .from('order-images')
          .upload(storagePath, fileBuffer, {
            contentType: img.mimeType || 'image/jpeg',
            upsert: true
          });

        if (uploadErr) {
          console.error(`图片${i + 1}上传Storage失败:`, JSON.stringify(uploadErr));
          continue;
        }

        // 写入数据库 images 表
        const { error: imgErr } = await supabaseAdmin
          .from('images')
          .insert({
            order_no: orderNo,
            openid: openid,
            storage_path: storagePath,
            file_name: fileName,
            mime_type: img.mimeType || 'image/jpeg'
          });

        if (imgErr) {
          console.error(`图片${i + 1}写入数据库失败:`, imgErr);
          continue;
        }

        successCount++;
        savedImages.push({ fileName, storagePath });
      } catch (fileErr) {
        console.error(`图片${i + 1}处理失败:`, fileErr);
      }
    }

    if (successCount === 0) {
      return res.status(500).json({ error: '所有图片上传失败，请重试' });
    }

    // 更新或创建订单记录
    try {
      const { data: existing } = await supabaseAdmin
        .from('orders')
        .select('id, image_count')
        .eq('order_no', orderNo)
        .eq('openid', openid)
        .single();

      if (existing) {
        await supabaseAdmin
          .from('orders')
          .update({
            image_count: existing.image_count + successCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabaseAdmin
          .from('orders')
          .insert({
            order_no: orderNo,
            openid: openid,
            image_count: successCount,
            status: 'active'
          });
      }
    } catch (err) {
      console.error('更新订单记录失败:', err);
    }

    console.log(`提交成功: 订单号=${orderNo}, 图片=${successCount}/${images.length}张`);

    res.json({
      success: true,
      orderNo,
      count: successCount,
      total: images.length,
      images: savedImages
    });
  } catch (err) {
    console.error('提交接口错误:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==================== 启动服务器 ====================
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('订单图片上传 API 服务已启动');
  console.log('  端口:', PORT);
  console.log('  Supabase:', SUPABASE_URL ? '已配置' : '未配置');
  console.log('  微信AppID:', WX_APPID ? '已配置' : '未配置');
  console.log('='.repeat(50));
});
