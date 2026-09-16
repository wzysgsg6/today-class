# 今日课表

一个轻量的静态 PWA：根据当前日期自动计算教学周和星期，打开即显示今天的课程。

## 特点

- 自动识别第几教学周、星期几
- 默认展示今天；可切换到本周视图
- 数据使用 AES-GCM 加密，密钥只放在链接的 URL fragment（`#k=...`）中，不会发送给服务器
- 支持添加到手机主屏幕，离线也能打开
- 学期开始日期和总周数可在页面内调整

## 本地构建

公开仓库不保存明文课表。更新时：

```bash
node scripts/encrypt.mjs ../today-class-private/schedule.json ./data.json
```

命令会输出一个新的 `key=`。把 `data.json` 提交到仓库，并用：

```text
https://<用户名>.github.io/today-class/#k=<key>
```

作为访问链接。

## 部署

仓库通过 GitHub Pages 直接从 `main` 分支根目录发布。
