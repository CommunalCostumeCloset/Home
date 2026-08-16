# Firebase Authentication 版本

这个版本已把网站的账号系统从 `localStorage` 改成：

- Firebase Authentication：邮箱 + 密码注册、登录、退出、忘记密码
- Cloud Firestore：保存用户名、姓名、邮箱、学生编号、角色和注册时间
- 登录状态由 Firebase 自动保持
- 新注册账号默认只能是普通用户，不能自行成为管理员
- 衣物、预约、归还等数据目前仍保留在浏览器 `localStorage`
- 衣物图片仍使用 Cloudinary

## 1. 创建 Firebase 项目

进入 Firebase Console，创建项目，然后注册一个 Web App。

在项目设置中找到 `firebaseConfig`，打开 `index.html`，搜索：

```js
const firebaseConfig = {
```

用 Firebase Console 提供的真实配置替换其中所有 `PASTE_...` 占位内容。

## 2. 启用邮箱密码登录

Firebase Console：

Authentication → Sign-in method → Email/Password → Enable

## 3. 创建 Cloud Firestore

Firebase Console：

Firestore Database → Create database

选择与你的用户最接近的区域。

## 4. 部署安全规则

把本压缩包中的 `firestore.rules` 内容复制到：

Firestore Database → Rules

然后点击 Publish。

这些规则会确保：

- 用户只能创建和修改自己的资料
- 普通用户不能把自己的 role 改成 admin
- 管理员可以管理用户角色

## 5. 创建第一个管理员

先在网站正常注册一个账号。

之后进入：

Firestore Database → users → 该用户的 uid 文档

把：

```text
role: "user"
```

手动修改成：

```text
role: "admin"
```

退出网站后重新登录，管理员菜单就会出现。

## 6. GitHub Pages

把 `index.html` 上传到 GitHub Pages 仓库即可。

同时在 Firebase Console 中打开：

Authentication → Settings → Authorized domains

确认你的 GitHub Pages 域名已经加入，例如：

```text
你的用户名.github.io
```

## 注意

这个阶段只迁移了账号系统。衣物、预约、归还、损坏报告仍使用每台设备自己的 localStorage。下一阶段应把这些集合迁移到 Firestore，才能让不同设备看到完全相同的衣物和预约状态。
