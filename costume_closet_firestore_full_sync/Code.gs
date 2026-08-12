const USERS_SHEET = 'Users';
const RESERVATIONS_SHEET = 'Reservations';
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

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'Communal Costume Closet reminders' }))
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
  ensureSheet_(spreadsheet, USERS_SHEET, [
    'userId', 'username', 'name', 'email', 'updatedAt'
  ]);
  ensureSheet_(spreadsheet, RESERVATIONS_SHEET, [
    'reservationId', 'itemId', 'itemName', 'borrowerName', 'username', 'email',
    'reservedAt', 'dueDate', 'status', 'lastReminderAt', 'updatedAt'
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
