# Google Sheet 管理总表 Version 3

这一版重新整理了 Google Sheet 的结构与视觉，让管理员更容易每天使用。

## 推荐的工作表顺序

1. Dashboard
2. Inventory
3. Reservations — 这里只显示当前“已预定、待取衣”
4. Borrowed — 当前已取衣、待归还
5. Pending Returns — 已提交归还照片、等待管理员确认
6. Damage History — 损坏/问题记录
7. Users
8. Rental History — 明确表示“所有历史 period”，包括所有归还/问题记录
9. System Data — 管理员平时不需要查看
10. Reminder Data — 逾期邮件提醒使用的底层数据

## 样式升级

- 统一使用 Arial
- 深紫色表头，和网站管理端视觉更一致
- 冻结顶部表头和关键前两列
- 自动筛选
- 行间浅色区分
- 状态自动上色
- 逾期天数自动标红
- Cloudinary 长链接显示成“查看照片”
- Dashboard 使用数字卡片显示重点数据
- Dashboard 增加 Needs Attention 区域

## 更新步骤

1. 打开现有 Apps Script 项目 `Costume Closet Reminder`
2. 打开 `Code.gs`
3. Command+A 全选，然后用这个 ZIP 中的新 `Code.gs` 全部替换
4. 保存
5. 顶部函数选择 `setup`，点击 Run
6. 如果执行成功，再运行一次 `syncAdminDashboard_` 不需要手动运行；只要打开管理员网站并点“同步 Google Sheet”即可
7. Deploy → Manage deployments → Edit → New version → Deploy
8. 网站 `index.html` 不需要再次修改（这一版只改 Google Sheet / Apps Script）

### 关于 Rental History

`Rental History` 被安排在 `Users` 后面，并明确作为“所有历史 period”的历史页面。

`Reservations` 现在只表示“当前预约、尚未取衣”，不再用作所有历史的概念。

网站和 Firestore 仍然是真正的数据源；Google Sheet 用于查看、筛选和管理导航，不建议直接修改表格状态来控制网站。
