# 取消预定报错修复

问题：
`firestoreSyncReady is not defined`

原因：
管理员取消预定和取消取衣函数引用了一个并不存在的变量 `firestoreSyncReady`。

修复：
已将两处判断改成网站实际存在的 Firebase 状态变量：

`firebaseReady && firebaseDb`

修复位置：
- adminCancelReservation()
- adminUndoPickup()

只需要替换 GitHub Pages 上的 `index.html`。
Google Apps Script / Code.gs 不需要因为这个错误重新修改。
