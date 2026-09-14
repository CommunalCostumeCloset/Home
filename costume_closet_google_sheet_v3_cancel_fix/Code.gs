const USERS_SHEET = 'Users';
const RESERVATIONS_SHEET = 'Reminder Data';
const DASHBOARD_SHEET = 'Dashboard';
const INVENTORY_SHEET = 'Inventory';
const ACTIVE_RESERVATIONS_SHEET = 'Reservations';
const BORROWED_SHEET = 'Borrowed';
const PENDING_RETURNS_SHEET = 'Pending Returns';
const RETURN_HISTORY_SHEET = 'Rental History';
const DAMAGE_HISTORY_SHEET = 'Damage History';
const SYSTEM_DATA_SHEET = 'System Data';
const SENDER_NAME = 'Communal Costume Closet';
const REPLY_TO = 'Communalcostumecloset@gmail.com';

/**
 * Run this once while signed into Communalcostumecloset@gmail.com.
 * It creates the Google Sheet and a daily overdue-reminder trigger.
 */
function setup() {
  let spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('Communal Costume Closet Data');
    PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  }

  ensureSheets_(spreadsheet);

  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sendOverdueReminders')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('sendOverdueReminders')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('Spreadsheet: ' + spreadsheet.getUrl());
  Logger.log('Setup complete. A daily reminder check will run around 9 AM in the script time zone.');
}

function doGet(e) {
  const spreadsheet = getSpreadsheet_();

  if (e && e.parameter && e.parameter.open === 'sheet') {
    const url = spreadsheet.getUrl();
    return HtmlService.createHtmlOutput(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0;url=' + url + '">' +
      '</head><body style="font-family:Arial;padding:24px">' +
      '正在打开管理总表… <a href="' + url + '">如果没有自动跳转，请点这里</a>' +
      '</body></html>'
    );
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      service: 'Communal Costume Closet reminders + admin dashboard',
      spreadsheetUrl: spreadsheet.getUrl()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const spreadsheet = getSpreadsheet_();
    ensureSheets_(spreadsheet);

    switch (payload.action) {
      case 'upsertUser':
        upsertUser_(spreadsheet, payload);
        break;
      case 'upsertReservation':
        upsertReservation_(spreadsheet, payload);
        break;
      case 'updateReservationStatus':
        updateReservationStatus_(spreadsheet, payload);
        break;
      case 'syncAdminDashboard':
        syncAdminDashboard_(spreadsheet, payload);
        break;
      default:
        throw new Error('Unknown action: ' + payload.action);
    }

    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: String(error.message || error) });
  }
}

function sendOverdueReminders() {
  const spreadsheet = getSpreadsheet_();
  ensureSheets_(spreadsheet);
  const sheet = spreadsheet.getSheetByName(RESERVATIONS_SHEET);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  const headers = values[0];
  const index = headerIndex_(headers);
  const today = dateKey_(new Date());
  let remainingQuota = MailApp.getRemainingDailyQuota();

  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    const status = String(row[index.status] || '');
    const dueDate = normalizeDateKey_(row[index.dueDate]);
    const email = String(row[index.email] || '').trim();
    const lastReminderAt = normalizeDateKey_(row[index.lastReminderAt]);

    // Only clothes that have actually been picked up should receive overdue reminders.
    if (status !== 'borrowed' || !email || !dueDate || dueDate >= today || lastReminderAt === today) continue;
    if (remainingQuota <= 0) break;

    const itemName = String(row[index.itemName] || '借用衣物');
    const borrowerName = String(row[index.borrowerName] || '同学');
    const overdueDays = daysBetween_(dueDate, today);
    const subject = `【奇装异服共享平台】${itemName} 已逾期 ${overdueDays} 天`;
    const plainBody = `${borrowerName}，你好：\n\n你借用的“${itemName}”原定最晚归还日期是 ${dueDate}，目前已逾期 ${overdueDays} 天。\n\n请尽快登录奇装异服共享平台，进入“归还衣物”页面，上传归还照片并完成归还。\n\n如有问题，请回复本邮件联系管理员。\n\nCommunal Costume Closet`;
    const htmlBody = `<p>${escapeHtml_(borrowerName)}，你好：</p>
      <p>你借用的 <strong>“${escapeHtml_(itemName)}”</strong> 原定最晚归还日期是 <strong>${dueDate}</strong>，目前已逾期 <strong>${overdueDays} 天</strong>。</p>
      <p>请尽快登录奇装异服共享平台，进入“归还衣物”页面，上传归还照片并完成归还。</p>
      <p>如有问题，请回复本邮件联系管理员。</p>
      <p>Communal Costume Closet</p>`;

    MailApp.sendEmail({
      to: email,
      subject,
      body: plainBody,
      htmlBody,
      name: SENDER_NAME,
      replyTo: REPLY_TO
    });

    sheet.getRange(rowIndex + 1, index.lastReminderAt + 1).setValue(today);
    remainingQuota--;
  }
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('Please run setup() first.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function ensureSheets_(spreadsheet) {
  // Legacy reminder tables (kept because the overdue-email workflow uses them).
  ensureSheet_(spreadsheet, USERS_SHEET, [
    'userId', 'username', 'name', 'email', 'updatedAt'
  ]);
  ensureSheet_(spreadsheet, RESERVATIONS_SHEET, [
    'reservationId', 'itemId', 'itemName', 'borrowerName', 'username', 'email',
    'reservedAt', 'dueDate', 'status', 'lastReminderAt', 'updatedAt'
  ]);

  // Human-friendly admin dashboard sheets.
  ensureSheet_(spreadsheet, DASHBOARD_SHEET, ['Communal Costume Closet 管理总览']);
  ensureSheet_(spreadsheet, INVENTORY_SHEET, [
    '衣物ID', '衣物名称', '类别', '尺寸', '当前状态', '当前用户',
    '预计取衣', '最晚归还', '逾期天数', '捐赠人', '照片', '最后同步'
  ]);
  ensureSheet_(spreadsheet, ACTIVE_RESERVATIONS_SHEET, [
    '预定ID', '衣物', '用户', '用户名', '邮箱', '预定日期', '预计取衣', '最晚归还', '状态'
  ]);
  ensureSheet_(spreadsheet, BORROWED_SHEET, [
    '预定ID', '衣物', '借用人', '用户名', '邮箱', '取衣日期', '最晚归还', '逾期天数', '状态'
  ]);
  ensureSheet_(spreadsheet, PENDING_RETURNS_SHEET, [
    '预定ID', '衣物', '归还人', '用户名', '邮箱', '最晚归还', '提交归还时间', '照片', '状态'
  ]);
  ensureSheet_(spreadsheet, DAMAGE_HISTORY_SHEET, [
    '记录ID', '衣物', '用户', '记录类型', '时间', '原定归还', '损坏/问题说明', '照片', '处理状态', '处理时间'
  ]);
  ensureSheet_(spreadsheet, RETURN_HISTORY_SHEET, [
    '记录ID', '衣物', '用户', '记录类型', '归还/报告时间', '原定归还', '损坏说明',
    '照片', '管理员已确认', '确认时间'
  ]);
  ensureSheet_(spreadsheet, SYSTEM_DATA_SHEET, [
    '说明', '值'
  ]);
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function upsertUser_(spreadsheet, payload) {
  const sheet = spreadsheet.getSheetByName(USERS_SHEET);
  const headers = sheet.getDataRange().getValues()[0];
  const index = headerIndex_(headers);
  const userId = String(payload.userId || '');
  const rowNumber = findRowByValue_(sheet, index.userId + 1, userId);
  const row = [
    userId,
    payload.username || '',
    payload.name || '',
    payload.email || '',
    new Date()
  ];
  writeRow_(sheet, rowNumber, row);
}

function upsertReservation_(spreadsheet, payload) {
  const sheet = spreadsheet.getSheetByName(RESERVATIONS_SHEET);
  const headers = sheet.getDataRange().getValues()[0];
  const index = headerIndex_(headers);
  const reservationId = String(payload.reservationId || '');
  const rowNumber = findRowByValue_(sheet, index.reservationId + 1, reservationId);
  const existingLastReminder = rowNumber ? sheet.getRange(rowNumber, index.lastReminderAt + 1).getValue() : '';
  const row = [
    reservationId,
    payload.itemId || '',
    payload.itemName || '',
    payload.borrowerName || '',
    payload.username || '',
    payload.email || '',
    payload.reservedAt || '',
    payload.dueDate || '',
    payload.status || 'reserved',
    existingLastReminder,
    new Date()
  ];
  writeRow_(sheet, rowNumber, row);
}

function updateReservationStatus_(spreadsheet, payload) {
  const sheet = spreadsheet.getSheetByName(RESERVATIONS_SHEET);
  const values = sheet.getDataRange().getValues();
  const index = headerIndex_(values[0]);
  const rowNumber = findRowByValue_(sheet, index.reservationId + 1, String(payload.reservationId || ''));
  if (!rowNumber) return;

  sheet.getRange(rowNumber, index.status + 1).setValue(payload.status || '');
  if (payload.dueDate) sheet.getRange(rowNumber, index.dueDate + 1).setValue(payload.dueDate);
  if (payload.email) sheet.getRange(rowNumber, index.email + 1).setValue(payload.email);
  sheet.getRange(rowNumber, index.updatedAt + 1).setValue(new Date());

  // If the item becomes borrowed again after a rejected return photo, allow a new reminder that day.
  if (payload.status === 'borrowed') {
    sheet.getRange(rowNumber, index.lastReminderAt + 1).clearContent();
  }
}



function syncAdminDashboard_(spreadsheet, payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const reservations = Array.isArray(payload.reservations) ? payload.reservations : [];
  const returnRecords = Array.isArray(payload.returnRecords) ? payload.returnRecords : [];
  const syncedAt = new Date();

  const activeByItem = {};
  reservations.forEach(r => {
    const status = String(r.status || 'reserved');
    if (['reserved', 'borrowed', 'pendingReturn'].includes(status)) {
      activeByItem[String(r.itemId)] = r;
    }
  });

  const inventoryRows = items
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'))
    .map(item => {
      const active = activeByItem[String(item.id)] || {};
      const status = String(item.status || 'available');
      const dueDate = normalizeDateKey_(active.dueDate || '');
      const overdueDays = status === 'borrowed' && dueDate ? overdueDaysFromDateKey_(dueDate) : '';
      return [
        String(item.id ?? ''),
        item.name || '',
        item.category || '',
        item.size || '',
        statusLabel_(status),
        active.reservedBy || active.borrowerName || '',
        active.pickupDate || '',
        dueDate || '',
        overdueDays,
        item.donor || '',
        item.imageUrl ? hyperlinkFormula_(item.imageUrl, '查看照片') : '',
        syncedAt
      ];
    });

  const activeRows = reservations
    .filter(r => String(r.status || 'reserved') === 'reserved')
    .sort(compareByDueDate_)
    .map(r => [
      String(r.id ?? ''),
      r.itemName || '',
      r.reservedBy || '',
      r.reservedByUsername || '',
      r.email || '',
      r.reservedAt || '',
      r.pickupDate || '',
      normalizeDateKey_(r.dueDate || ''),
      statusLabel_('reserved')
    ]);

  const borrowedRows = reservations
    .filter(r => String(r.status || '') === 'borrowed')
    .sort(compareByDueDate_)
    .map(r => {
      const dueDate = normalizeDateKey_(r.dueDate || '');
      return [
        String(r.id ?? ''),
        r.itemName || '',
        r.reservedBy || '',
        r.reservedByUsername || '',
        r.email || '',
        r.pickupDate || '',
        dueDate,
        overdueDaysFromDateKey_(dueDate),
        statusLabel_('borrowed')
      ];
    });

  const pendingRows = reservations
    .filter(r => String(r.status || '') === 'pendingReturn')
    .sort(compareByDueDate_)
    .map(r => [
      String(r.id ?? ''),
      r.itemName || '',
      r.reservedBy || '',
      r.reservedByUsername || '',
      r.email || '',
      normalizeDateKey_(r.dueDate || ''),
      r.returnedAt || '',
      r.returnPhotoUrl ? hyperlinkFormula_(r.returnPhotoUrl, '查看照片') : '',
      statusLabel_('pendingReturn')
    ]);

  const historyRows = returnRecords
    .slice()
    .sort((a, b) => String(b.returnedAt || b.reportedAt || b.date || '').localeCompare(String(a.returnedAt || a.reportedAt || a.date || '')))
    .map(r => [
      String(r.id ?? ''),
      r.itemName || '',
      r.returnedBy || r.reportedBy || '',
      recordTypeLabel_(r.recordType || 'return'),
      r.returnedAt || r.reportedAt || r.date || '',
      normalizeDateKey_(r.dueDate || ''),
      r.damageNote || '',
      r.photoUrl ? hyperlinkFormula_(r.photoUrl, '查看照片') : '',
      r.confirmed ? '是' : '否',
      r.confirmedAt || ''
    ]);

  const damageRows = returnRecords
    .filter(r => {
      const note = String(r.damageNote || '').trim();
      return (note && note !== '无') || String(r.recordType || '') === 'pickupDamage';
    })
    .sort((a, b) => String(b.returnedAt || b.reportedAt || b.date || '').localeCompare(String(a.returnedAt || a.reportedAt || a.date || '')))
    .map(r => [
      String(r.id ?? ''),
      r.itemName || '',
      r.returnedBy || r.reportedBy || '',
      recordTypeLabel_(r.recordType || 'return'),
      r.returnedAt || r.reportedAt || r.date || '',
      normalizeDateKey_(r.dueDate || ''),
      r.damageNote || '',
      r.photoUrl ? hyperlinkFormula_(r.photoUrl, '查看照片') : '',
      r.damageResolved ? '已处理' : (r.confirmed ? '已确认' : '待处理'),
      r.damageResolvedAt || r.confirmedAt || ''
    ]);

  writeTable_(spreadsheet.getSheetByName(INVENTORY_SHEET), [
    '衣物ID', '衣物名称', '类别', '尺寸', '当前状态', '当前用户',
    '预计取衣', '最晚归还', '逾期天数', '捐赠人', '照片', '最后同步'
  ], inventoryRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(ACTIVE_RESERVATIONS_SHEET), [
    '预定ID', '衣物', '用户', '用户名', '邮箱', '预定日期', '预计取衣', '最晚归还', '状态'
  ], activeRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(BORROWED_SHEET), [
    '预定ID', '衣物', '借用人', '用户名', '邮箱', '取衣日期', '最晚归还', '逾期天数', '状态'
  ], borrowedRows, { freezeColumns: 2, overdueColumn: 8 });

  writeTable_(spreadsheet.getSheetByName(PENDING_RETURNS_SHEET), [
    '预定ID', '衣物', '归还人', '用户名', '邮箱', '最晚归还', '提交归还时间', '照片', '状态'
  ], pendingRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(DAMAGE_HISTORY_SHEET), [
    '记录ID', '衣物', '用户', '记录类型', '时间', '原定归还', '损坏/问题说明', '照片', '处理状态', '处理时间'
  ], damageRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(RETURN_HISTORY_SHEET), [
    '记录ID', '衣物', '用户', '记录类型', '归还/报告时间', '原定归还', '损坏说明',
    '照片', '管理员已确认', '确认时间'
  ], historyRows, { freezeColumns: 2 });

  writeDashboard_(spreadsheet, items, reservations, returnRecords, syncedAt);
  writeSystemData_(spreadsheet, syncedAt);
  reorderDashboardSheets_(spreadsheet);
}

function writeDashboard_(spreadsheet, items, reservations, returnRecords, syncedAt) {
  const sheet = spreadsheet.getSheetByName(DASHBOARD_SHEET);
  sheet.clear();

  const available = items.filter(i => String(i.status || 'available') === 'available').length;
  const reserved = reservations.filter(r => String(r.status || 'reserved') === 'reserved').length;
  const borrowed = reservations.filter(r => String(r.status || '') === 'borrowed').length;
  const pending = reservations.filter(r => String(r.status || '') === 'pendingReturn').length;
  const overdue = reservations.filter(r => {
    if (String(r.status || '') !== 'borrowed') return false;
    const due = normalizeDateKey_(r.dueDate || '');
    return due && due < dateKey_(new Date());
  }).length;
  const damageOpen = returnRecords.filter(r => {
    const note = String(r.damageNote || '').trim();
    return note && note !== '无' && !r.damageResolved;
  }).length;

  sheet.getRange('A1:H1').merge();
  sheet.getRange('A1')
    .setValue('COMMUNAL COSTUME CLOSET · ADMIN DASHBOARD')
    .setFontFamily('Arial')
    .setFontSize(18)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#5d3c6b')
    .setHorizontalAlignment('left');

  sheet.getRange('A2:H2').merge();
  sheet.getRange('A2')
    .setValue('最后同步：' + Utilities.formatDate(syncedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'))
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontColor('#6b6070')
    .setBackground('#f6f1f8');

  const cards = [
    ['衣物总数', items.length, '#f2ecf6'],
    ['可借', available, '#e6f4ea'],
    ['待取衣', reserved, '#fff4d6'],
    ['借出中', borrowed, '#fde8e7'],
    ['待确认归还', pending, '#eee7f7'],
    ['逾期', overdue, '#f7d7d7'],
    ['待处理损坏', damageOpen, '#fdebd2']
  ];
  cards.forEach((card, i) => {
    const col = i + 1;
    sheet.getRange(4, col).setValue(card[0])
      .setFontFamily('Arial')
      .setFontSize(10)
      .setFontWeight('bold')
      .setFontColor('#5c5260')
      .setBackground(card[2])
      .setHorizontalAlignment('center');
    sheet.getRange(5, col).setValue(card[1])
      .setFontFamily('Arial')
      .setFontSize(20)
      .setFontWeight('bold')
      .setFontColor('#2f2533')
      .setBackground(card[2])
      .setHorizontalAlignment('center');
  });

  sheet.getRange('A8:H8').merge();
  sheet.getRange('A8').setValue('NEEDS ATTENTION')
    .setFontFamily('Arial').setFontSize(12).setFontWeight('bold')
    .setFontColor('#ffffff').setBackground('#7a5a86');

  const attention = [
    ['逾期未归还', overdue],
    ['等待管理员确认归还', pending],
    ['待处理损坏/问题', damageOpen]
  ];
  sheet.getRange(9, 1, attention.length, 2).setValues(attention);
  sheet.getRange(9, 1, attention.length, 2).setFontFamily('Arial');
  sheet.getRange(9, 1, attention.length, 1).setFontWeight('bold');
  sheet.getRange(9, 2, attention.length, 1).setHorizontalAlignment('center');

  sheet.setFrozenRows(2);
  for (let c = 1; c <= 8; c++) sheet.setColumnWidth(c, 120);
  sheet.setRowHeight(1, 34);
  sheet.setRowHeight(2, 24);
}

function writeSystemData_(spreadsheet, syncedAt) {
  const sheet = spreadsheet.getSheetByName(SYSTEM_DATA_SHEET);
  sheet.clear();
  const rows = [
    ['说明', '值'],
    ['用途', '系统辅助页。管理员日常不需要查看。'],
    ['最后 Dashboard 同步', syncedAt],
    ['注意', '网站 / Firestore 仍然是真正的数据源。请不要通过这个 Sheet 修改网站状态。']
  ];
  sheet.getRange(1,1,rows.length,2).setValues(rows);
  sheet.getRange(1,1,1,2).setBackground('#5d3c6b').setFontColor('#ffffff').setFontWeight('bold').setFontFamily('Arial');
  sheet.getRange(2,1,rows.length-1,2).setFontFamily('Arial');
  sheet.setColumnWidth(1,180);
  sheet.setColumnWidth(2,480);
}

function writeTable_(sheet, headers, rows, options = {}) {
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(options.freezeColumns || 1);

  const header = sheet.getRange(1, 1, 1, headers.length);
  header
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#5d3c6b')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 30);

  const totalRows = Math.max(1, rows.length + 1);
  const body = sheet.getRange(1, 1, totalRows, headers.length);
  body.setFontFamily('Arial').setVerticalAlignment('middle');

  if (rows.length) {
    sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
    sheet.getRange(2, 1, rows.length, headers.length)
      .setFontSize(10)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    for (let r = 2; r <= rows.length + 1; r++) {
      sheet.getRange(r, 1, 1, headers.length)
        .setBackground(r % 2 === 0 ? '#fbf9fc' : '#ffffff');
      sheet.setRowHeight(r, 28);
    }
  }

  headers.forEach((headerName, index) => {
    let width = 112;
    if (/衣物名称|衣物|用户|借用人|归还人|捐赠人/.test(headerName)) width = 150;
    if (/邮箱/.test(headerName)) width = 210;
    if (/照片/.test(headerName)) width = 105;
    if (/时间|日期|最晚归还|最后同步|预计取衣/.test(headerName)) width = 135;
    if (/损坏|问题/.test(headerName)) width = 240;
    if (/状态/.test(headerName)) width = 135;
    sheet.setColumnWidth(index + 1, width);
  });

  applyStatusFormatting_(sheet, headers, rows.length);
  if (options.overdueColumn && rows.length) {
    const overdueRange = sheet.getRange(2, options.overdueColumn, rows.length, 1);
    const rules = sheet.getConditionalFormatRules();
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThan(0)
        .setBackground('#f6c7c3')
        .setFontColor('#9c1c1c')
        .setBold(true)
        .setRanges([overdueRange])
        .build()
    );
    sheet.setConditionalFormatRules(rules);
  }
}

function applyStatusFormatting_(sheet, headers, rowCount) {
  const statusIndex = headers.findIndex(h => h === '当前状态' || h === '状态' || h === '处理状态');
  if (statusIndex === -1 || rowCount === 0) {
    sheet.setConditionalFormatRules([]);
    return;
  }

  const range = sheet.getRange(2, statusIndex + 1, rowCount, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('可借用')
      .setBackground('#dff2e4').setFontColor('#27653b').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('已预定，待取衣')
      .setBackground('#fff0c7').setFontColor('#8a5b00').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('已取衣，待归还')
      .setBackground('#f9d9d6').setFontColor('#9b2e2e').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('等待管理员处理')
      .setBackground('#e9ddf3').setFontColor('#684176').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('待处理')
      .setBackground('#f9d9d6').setFontColor('#9b2e2e').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('已处理')
      .setBackground('#dff2e4').setFontColor('#27653b').setBold(true)
      .setRanges([range]).build()
  ];
  sheet.setConditionalFormatRules(rules);
}

function statusLabel_(status) {
  const map = {
    available: '可借用',
    reserved: '已预定，待取衣',
    borrowed: '已取衣，待归还',
    pendingReturn: '等待管理员处理',
    completed: '已完成',
    cancelled: '已取消'
  };
  return map[String(status || '')] || String(status || '');
}

function recordTypeLabel_(recordType) {
  const map = {
    return: '归还记录',
    pickupDamage: '取衣时发现问题'
  };
  return map[String(recordType || '')] || String(recordType || '');
}

function hyperlinkFormula_(url, label) {
  const safeUrl = String(url || '').replace(/"/g, '""');
  const safeLabel = String(label || '打开').replace(/"/g, '""');
  return '=HYPERLINK("' + safeUrl + '","' + safeLabel + '")';
}

function compareByDueDate_(a, b) {
  return String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'));
}

function overdueDaysFromDateKey_(dueDate) {
  const due = normalizeDateKey_(dueDate);
  const today = dateKey_(new Date());
  if (!due || due >= today) return '';
  return daysBetween_(due, today);
}

function reorderDashboardSheets_(spreadsheet) {
  const preferredOrder = [
    DASHBOARD_SHEET,
    INVENTORY_SHEET,
    ACTIVE_RESERVATIONS_SHEET,
    BORROWED_SHEET,
    PENDING_RETURNS_SHEET,
    DAMAGE_HISTORY_SHEET,
    USERS_SHEET,
    RETURN_HISTORY_SHEET,
    SYSTEM_DATA_SHEET
  ];
  preferredOrder.forEach((name, index) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) {
      spreadsheet.setActiveSheet(sheet);
      spreadsheet.moveActiveSheet(index + 1);
    }
  });

  // Keep the legacy reminder table at the end if it exists under its old name.
  const legacy = spreadsheet.getSheetByName('Reservations');
  if (legacy && legacy.getName() !== ACTIVE_RESERVATIONS_SHEET) {
    spreadsheet.setActiveSheet(legacy);
    spreadsheet.moveActiveSheet(spreadsheet.getSheets().length);
  }
  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(DASHBOARD_SHEET));
}

function writeRow_(sheet, rowNumber, row) {
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function findRowByValue_(sheet, column, value) {
  if (!value || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = values.findIndex(row => String(row[0]) === String(value));
  return index === -1 ? 0 : index + 2;
}

function headerIndex_(headers) {
  return headers.reduce((result, header, index) => {
    result[String(header)] = index;
    return result;
  }, {});
}

function dateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeDateKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return dateKey_(value);
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function daysBetween_(fromDateKey, toDateKey) {
  const from = new Date(fromDateKey + 'T00:00:00');
  const to = new Date(toDateKey + 'T00:00:00');
  return Math.max(1, Math.round((to - from) / 86400000));
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
