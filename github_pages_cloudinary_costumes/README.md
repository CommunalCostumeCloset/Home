# 奇装异服共享平台：GitHub Pages + Cloudinary 版本

这个版本不需要 Node / Python 服务器，可以直接托管到 GitHub Pages。

## 已经填好的 Cloudinary 设置

```js
const CLOUD_NAME = 'vicummbs';
const UPLOAD_PRESET = 'returned_costumes_upload';
```

上传照片会使用 unsigned upload preset 上传到 Cloudinary。

## 重要安全提醒

不要把 API Secret 放进 GitHub Pages。API Secret 只能放在后端服务器里。你之前发过 secret，建议去 Cloudinary 后台 regenerate/rotate。

## 管理员账号

```text
用户名：admin
密码：123456
```

## 用户测试账号

```text
用户名：xiaoming
密码：123456
```

## 上传后的照片位置

代码会尽量把照片上传到：

```text
returned costumes/YYYY-MM-DD/
```

同时会加上 tag：

```text
returned_costume
return_YYYY_MM_DD
```

注意：如果 Cloudinary 的 unsigned preset 不允许前端覆盖 folder / asset_folder，照片仍然会进入你 preset 里设置的 `returned costumes` 文件夹，但管理员后台仍可按 tag 读取。

## 管理员后台如何显示所有照片

管理员后台使用 Cloudinary 的 client-side asset list by tag：

```text
https://res.cloudinary.com/vicummbs/image/list/returned_costume.json
```

你需要在 Cloudinary 里允许 Resource list：

1. 进入 Cloudinary Console
2. Settings
3. Security
4. 找到 Restricted image types
5. 取消勾选 Resource list / List
6. 保存

如果不做这一步，用户仍然可以上传照片，但是管理员后台无法从 GitHub Pages 公开读取照片列表。

## GitHub Pages 部署方法

1. 新建 GitHub repository
2. 上传这个文件夹里的 `index.html`
3. 进入 repository 的 Settings
4. Pages
5. Source 选择 `Deploy from a branch`
6. Branch 选择 `main` 和 `/root`
7. 保存

几分钟后 GitHub 会给你一个网址。

## 使用流程

1. 登录普通用户，例如 xiaoming / 123456
2. 进入衣物目录
3. 借一件衣服
4. 进入归还衣物
5. 上传照片并确认归还
6. 用 admin / 123456 登录
7. 进入管理员后台
8. 点击刷新云端归还照片

## 现实限制

这个版本适合 GitHub Pages 展示。它可以云端保存照片，但用户、衣物、预定记录仍主要存在浏览器 localStorage 里。也就是说：

- 同一台电脑刷新不会丢
- 换电脑可能看不到之前的预定状态
- Cloudinary 里照片是真实云端保存的

如果以后要做成真正全校可用的网站，需要再加一个云数据库，例如 Firebase Firestore、Supabase 或 Airtable。
