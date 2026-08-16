# Firestore 全站同步版本

这个版本不再只同步账号。以下数据现在都以 Cloud Firestore 为共享来源：

- `items`：衣物目录、照片 URL、当前状态
- `reservations`：预定、取衣、待归还、等待管理员确认
- `returnRecords`：归还历史、取衣/归还损坏提醒、管理员处理状态
- `users`：Firebase 用户资料与管理员角色

Cloudinary 继续负责实际图片文件；Firestore 保存图片 URL 和业务状态。

## 你现在必须做的 2 件事

### 1. 更新 Firestore Rules

Firebase Console → Firestore → 规则，把压缩包里的 `firestore.rules` 全部复制进去并发布。

旧规则只允许 `users`，如果不更新，衣物/预定/归还同步会出现 Permission Denied。

### 2. 用管理员设备迁移旧数据

请先把自己的 Firebase 用户在 Firestore `users/{uid}` 中的：

`role: "user"`

改成：

`role: "admin"`

然后用**目前保存着最完整衣物、Darkstar Harbinger、预约和历史记录的那台电脑**登录网站。

管理员菜单 → **衣物状态总表** → 点击：

**“迁移这台设备的旧数据到 Firestore”**

这个操作会把这台设备原先 localStorage 中的 `items / reservations / returnRecords` 上传到 Firestore。它不会删除已有的不同 ID 云端记录。

迁移完成后，其它设备刷新/登录就会自动看到相同数据。

## 实时同步

页面通过 Firestore `onSnapshot` 监听共享数据。一个设备上的预定、取衣、归还或管理员确认，会自动传播到其它已打开的网站页面。

## 关于旧数据

迁移前，网站会保留当前设备的 localStorage 作为缓存/备份。迁移后 Firestore 才是主要共享来源。

## 重要限制

本版本仍是纯前端 GitHub Pages 应用。虽然 Firestore Rules 已限制普通用户不能直接编辑完整衣物资料，但复杂的业务规则（例如完全防止恶意客户端伪造状态）如果未来用于正式校级生产环境，最好进一步用 Cloud Functions / Firebase backend enforcement 实现。
