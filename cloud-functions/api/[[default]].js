// cloud-functions/api/[[default]].js
// EdgeOne Pages Node Functions - 订单图片上传 API
// 所有 /api/* 请求由该文件处理（catch-all 路由）

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const app = express();

// ==================== 配置 ====================
// EdgeOne Pages 环境变量通过控制台设置，无需 dotenv
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WX_APPID = process.env.WX_APPID;
const WX_SECRET = process.env.WX_SECRET;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.endsWith('/health')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ==================== 微信登录接口 ====================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: '缺少登录凭证(code)' });
    }

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

// POST /api/upload/submit
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

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString()
  });
});

// ⚠️ 关键：导出 Express 实例，不要调用 app.listen()
export default app;
