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
      'Opening admin dashboard… <a href="' + url + '">Click here if you are not redirected automatically</a>' +
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

    const itemName = String(row[index.itemName] || 'borrowed costume');
    const borrowerName = String(row[index.borrowerName] || 'Hi');
    const overdueDays = daysBetween_(dueDate, today);
    const subject = `[Communal Costume Closet] ${itemName} is overdue by ${overdueDays} days`;
    const plainBody = `Hello ${borrowerName},\n\nThe costume “${itemName}” was due on ${dueDate} and is now ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue.\n\nPlease log in to Communal Costume Closet, open the Return Costume page, upload a return photo, and complete the return as soon as possible.\n\nIf you have any questions, reply to this email to contact the administrator.\n\nCommunal Costume Closet`;
    const htmlBody = `<p>Hello ${escapeHtml_(borrowerName)},</p>
      <p>The costume <strong>“${escapeHtml_(itemName)}”</strong> was due on <strong>${dueDate}</strong> and is now <strong>${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue</strong>.</p>
      <p>Please log in to Communal Costume Closet, open the <strong>Return Costume</strong> page, upload a return photo, and complete the return as soon as possible.</p>
      <p>If you have any questions, reply to this email to contact the administrator.</p>
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
  ensureSheet_(spreadsheet, DASHBOARD_SHEET, ['Communal Costume Closet Admin Dashboard']);
  ensureSheet_(spreadsheet, INVENTORY_SHEET, [
    'Costume ID', 'Costume Name', 'Category', 'Size', 'Gender', 'Catalogue Visibility', 'Current Status', 'Current User',
    'Pickup Date', 'Due Date', 'Days Overdue', 'Donor', 'Description', 'Photo', 'Last Sync'
  ]);
  ensureSheet_(spreadsheet, ACTIVE_RESERVATIONS_SHEET, [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Reserved On', 'Pickup Date', 'Due Date', 'Status'
  ]);
  ensureSheet_(spreadsheet, BORROWED_SHEET, [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Pickup Date', 'Due Date', 'Days Overdue', 'Status'
  ]);
  ensureSheet_(spreadsheet, PENDING_RETURNS_SHEET, [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Due Date', 'Return Submitted', 'Photo', 'Status'
  ]);
  ensureSheet_(spreadsheet, DAMAGE_HISTORY_SHEET, [
    'Record ID', 'Costume', 'User', 'Record Type', 'Time', 'Original Due Date', 'Damage / Issue Notes', 'Photo', 'Resolution Status', 'Resolved At'
  ]);
  ensureSheet_(spreadsheet, RETURN_HISTORY_SHEET, [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Reserved On',
    'Due Date', 'Final / Current Status', 'Last Updated'
  ]);
  ensureSheet_(spreadsheet, SYSTEM_DATA_SHEET, [
    'Description', 'Value'
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




function syncUsersSnapshot_(spreadsheet, users) {
  if (!Array.isArray(users) || !users.length) return;
  const sheet = spreadsheet.getSheetByName(USERS_SHEET);
  users.forEach(user => {
    const payload = {
      userId: user.userId || user.uid || '',
      username: user.username || '',
      name: user.name || '',
      email: user.email || ''
    };
    if (payload.userId) upsertUser_(spreadsheet, payload);
  });
}

function buildUserLookup_(spreadsheet, payloadUsers) {
  const lookup = { byUid: {}, byUsername: {}, byEmail: {} };

  function addUser_(user) {
    const normalized = {
      userId: String(user.userId || user.uid || '').trim(),
      username: String(user.username || '').trim(),
      name: String(user.name || '').trim(),
      email: String(user.email || '').trim()
    };
    if (normalized.userId) lookup.byUid[normalized.userId] = normalized;
    if (normalized.username) lookup.byUsername[normalized.username.toLowerCase()] = normalized;
    if (normalized.email) lookup.byEmail[normalized.email.toLowerCase()] = normalized;
  }

  // Firestore snapshot sent by the admin website is the most authoritative source.
  if (Array.isArray(payloadUsers)) {
    payloadUsers.forEach(addUser_);
  }

  // Keep the existing Apps Script Users tab as a fallback for older records.
  const sheet = spreadsheet.getSheetByName(USERS_SHEET);
  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const index = headerIndex_(headers);

    for (let i = 1; i < values.length; i++) {
      addUser_({
        userId: rowValue_(values[i], index.userId),
        username: rowValue_(values[i], index.username),
        name: rowValue_(values[i], index.name),
        email: rowValue_(values[i], index.email)
      });
    }
  }

  return lookup;
}

function rowValue_(row, index) {
  return (index === undefined || index === null || index < 0) ? '' : row[index];
}

function reservationUser_(reservation, userLookup) {
  const uid = String(reservation.userUid || '').trim();
  const username = String(reservation.reservedByUsername || reservation.username || '').trim();
  const email = String(reservation.email || '').trim();

  const matched =
    (uid && userLookup.byUid[uid]) ||
    (username && userLookup.byUsername[username.toLowerCase()]) ||
    (email && userLookup.byEmail[email.toLowerCase()]) ||
    null;

  return {
    name: (() => {
      const direct = String(reservation.reservedBy || reservation.reservedByName || reservation.userName || '').trim();
      if (direct && direct !== 'Unknown User' && direct !== 'User') return direct;
      return (matched && matched.name) || username || email || 'Unknown User';
    })(),
    username:
      username ||
      (matched && matched.username) ||
      '',
    email:
      email ||
      (matched && matched.email) ||
      ''
  };
}


function buildReminderReservationLookup_(spreadsheet) {
  const lookup = {};
  const sheet = spreadsheet.getSheetByName(RESERVATIONS_SHEET); // Reminder Data
  if (!sheet || sheet.getLastRow() < 2) return lookup;

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const index = headerIndex_(headers);

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = String(rowValue_(row, index.reservationId) || '').trim();
    if (!id) continue;
    lookup[id] = {
      reservationId: id,
      itemId: String(rowValue_(row, index.itemId) || '').trim(),
      itemName: String(rowValue_(row, index.itemName) || '').trim(),
      reservedBy: String(rowValue_(row, index.borrowerName) || '').trim(),
      reservedByUsername: String(rowValue_(row, index.username) || '').trim(),
      email: String(rowValue_(row, index.email) || '').trim(),
      reservedAt: rowValue_(row, index.reservedAt) || '',
      dueDate: rowValue_(row, index.dueDate) || '',
      status: String(rowValue_(row, index.status) || '').trim()
    };
  }
  return lookup;
}

function enrichReservationIdentity_(reservation, reminderLookup, userLookup) {
  const r = Object.assign({}, reservation || {});
  const reminder = reminderLookup[String(r.id || r.reservationId || '')] || {};

  if (!r.itemName) r.itemName = reminder.itemName || '';
  if (!r.reservedBy || r.reservedBy === 'Unknown User') r.reservedBy = reminder.reservedBy || '';
  if (!r.reservedByUsername) r.reservedByUsername = reminder.reservedByUsername || '';
  if (!r.email) r.email = reminder.email || '';
  if (!r.reservedAt) r.reservedAt = reminder.reservedAt || '';
  if (!r.dueDate) r.dueDate = reminder.dueDate || '';

  const resolved = reservationUser_(r, userLookup);
  r.resolvedName = resolved.name;
  r.resolvedUsername = resolved.username;
  r.resolvedEmail = resolved.email;
  return r;
}

function syncAdminDashboard_(spreadsheet, payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const reservations = Array.isArray(payload.reservations) ? payload.reservations : [];
  const returnRecords = Array.isArray(payload.returnRecords) ? payload.returnRecords : [];
  const users = Array.isArray(payload.users) ? payload.users : [];
  const syncedAt = new Date();

  syncUsersSnapshot_(spreadsheet, users);
  const userLookup = buildUserLookup_(spreadsheet, users);
  const reminderLookup = buildReminderReservationLookup_(spreadsheet);

  const activeByItem = {};
  reservations.forEach(r => {
    const status = String(r.status || 'reserved');
    if (['reserved', 'borrowed', 'pendingReturn'].includes(status)) {
      activeByItem[String(r.itemId)] = enrichReservationIdentity_(r, reminderLookup, userLookup);
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
        item.gender || '',
        item.hidden ? 'Hidden' : 'Visible',
        statusLabel_(status),
        Object.keys(active).length ? (active.resolvedName || reservationUser_(active, userLookup).name || '') : '',
        active.pickupDate || '',
        dueDate || '',
        overdueDays,
        item.donor || '',
        item.description || '',
        item.imageUrl ? hyperlinkFormula_(item.imageUrl, 'View Photo') : '',
        syncedAt
      ];
    });

  const activeRows = reservations
    .filter(r => String(r.status || 'reserved') === 'reserved')
    .sort(compareByDueDate_)
    .map(r => {
      const enriched = enrichReservationIdentity_(r, reminderLookup, userLookup);
      const user = {
        name: enriched.resolvedName,
        username: enriched.resolvedUsername,
        email: enriched.resolvedEmail
      };
      return [
        String(r.id ?? ''),
        r.itemName || '',
        user.name,
        user.username,
        user.email,
        r.reservedAt || '',
        r.pickupDate || '',
        normalizeDateKey_(r.dueDate || ''),
        statusLabel_('reserved')
      ];
    });

  const borrowedRows = reservations
    .filter(r => String(r.status || '') === 'borrowed')
    .sort(compareByDueDate_)
    .map(r => {
      const enriched = enrichReservationIdentity_(r, reminderLookup, userLookup);
      const dueDate = normalizeDateKey_(enriched.dueDate || r.dueDate || '');
      const user = {
        name: enriched.resolvedName,
        username: enriched.resolvedUsername,
        email: enriched.resolvedEmail
      };
      return [
        String(r.id ?? ''),
        r.itemName || '',
        user.name,
        user.username,
        user.email,
        r.pickupDate || '',
        dueDate,
        overdueDaysFromDateKey_(dueDate),
        statusLabel_('borrowed')
      ];
    });

  const pendingRows = reservations
    .filter(r => String(r.status || '') === 'pendingReturn')
    .sort(compareByDueDate_)
    .map(r => {
      const enriched = enrichReservationIdentity_(r, reminderLookup, userLookup);
      const user = {
        name: enriched.resolvedName,
        username: enriched.resolvedUsername,
        email: enriched.resolvedEmail
      };
      return [
        String(r.id ?? ''),
        r.itemName || '',
        user.name,
        user.username,
        user.email,
        normalizeDateKey_(r.dueDate || ''),
        r.returnedAt || '',
        r.returnPhotoUrl ? hyperlinkFormula_(r.returnPhotoUrl, 'View Photo') : '',
        statusLabel_('pendingReturn')
      ];
    });

  // "Rental History" is ALL rental/reservation records, not just return photos.
  // Reminder Data preserves records even after the live Firestore reservation is deleted.
  const historyRows = buildRentalHistoryRows_(spreadsheet, userLookup);

  const damageRows = returnRecords
    .filter(r => {
      const note = String(r.damageNote || '').trim();
      return (note && note !== 'None') || String(r.recordType || '') === 'pickupDamage';
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
      r.photoUrl ? hyperlinkFormula_(r.photoUrl, 'View Photo') : '',
      r.damageResolved ? 'Resolved' : (r.confirmed ? 'Confirmed' : 'Pending'),
      r.damageResolvedAt || r.confirmedAt || ''
    ]);

  writeTable_(spreadsheet.getSheetByName(INVENTORY_SHEET), [
    'Costume ID', 'Costume Name', 'Category', 'Size', 'Gender', 'Catalogue Visibility',
    'Current Status', 'Current User', 'Pickup Date', 'Due Date', 'Days Overdue',
    'Donor', 'Description', 'Photo', 'Last Sync'
  ], inventoryRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(ACTIVE_RESERVATIONS_SHEET), [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Reserved On', 'Pickup Date', 'Due Date', 'Status'
  ], activeRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(BORROWED_SHEET), [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Pickup Date', 'Due Date', 'Days Overdue', 'Status'
  ], borrowedRows, { freezeColumns: 2, overdueColumn: 8 });

  writeTable_(spreadsheet.getSheetByName(PENDING_RETURNS_SHEET), [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Due Date', 'Return Submitted', 'Photo', 'Status'
  ], pendingRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(DAMAGE_HISTORY_SHEET), [
    'Record ID', 'Costume', 'User', 'Record Type', 'Time', 'Original Due Date', 'Damage / Issue Notes', 'Photo', 'Resolution Status', 'Resolved At'
  ], damageRows, { freezeColumns: 2 });

  writeTable_(spreadsheet.getSheetByName(RETURN_HISTORY_SHEET), [
    'Reservation ID', 'Costume', 'Preferred Name', 'Legal Name', 'Email', 'Reserved On',
    'Due Date', 'Final / Current Status', 'Last Updated'
  ], historyRows, { freezeColumns: 2 });

  writeDashboard_(spreadsheet, items, reservations, returnRecords, syncedAt);
  writeSystemData_(spreadsheet, syncedAt);
  reorderDashboardSheets_(spreadsheet);
}


function buildRentalHistoryRows_(spreadsheet, userLookup) {
  const sheet = spreadsheet.getSheetByName(RESERVATIONS_SHEET); // Reminder Data
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const index = headerIndex_(headers);
  const result = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const reservation = {
      id: rowValue_(row, index.reservationId),
      itemName: rowValue_(row, index.itemName),
      reservedBy: rowValue_(row, index.borrowerName),
      reservedByUsername: rowValue_(row, index.username),
      email: rowValue_(row, index.email),
      reservedAt: rowValue_(row, index.reservedAt),
      dueDate: rowValue_(row, index.dueDate),
      status: rowValue_(row, index.status)
    };
    const user = reservationUser_(reservation, userLookup);

    result.push([
      String(reservation.id || ''),
      reservation.itemName || '',
      user.name,
      user.username,
      user.email,
      normalizeDateKey_(reservation.reservedAt) || reservation.reservedAt || '',
      normalizeDateKey_(reservation.dueDate) || reservation.dueDate || '',
      statusLabel_(reservation.status || ''),
      rowValue_(row, index.updatedAt) || ''
    ]);
  }

  result.sort((a, b) => String(b[8] || b[5] || '').localeCompare(String(a[8] || a[5] || '')));
  return result;
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
    return note && note !== 'None' && !r.damageResolved;
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
    .setValue('Last Sync：' + Utilities.formatDate(syncedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'))
    .setFontFamily('Arial')
    .setFontSize(10)
    .setFontColor('#6b6070')
    .setBackground('#f6f1f8');

  const cards = [
    ['Total Costumes', items.length, '#f2ecf6'],
    ['Available', available, '#e6f4ea'],
    ['Awaiting Pickup', reserved, '#fff4d6'],
    ['Borrowed', borrowed, '#fde8e7'],
    ['Awaiting Return Confirmation', pending, '#eee7f7'],
    ['Overdue', overdue, '#f7d7d7'],
    ['Open Damage Reports', damageOpen, '#fdebd2']
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
    ['Overdue Returns', overdue],
    ['Returns Awaiting Admin Confirmation', pending],
    ['Open Damage / Issues', damageOpen]
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
    ['Description', 'Value'],
    ['Purpose', 'System support page. Admins do not normally need to view it.'],
    ['Last Dashboard Sync', syncedAt],
    ['Note', 'The website / Firestore remains the source of truth. Do not change website status through this Sheet.']
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
    if (/Costume Name|Costume|User|Borrower|Returned By|Donor/.test(headerName)) width = 150;
    if (/Email/.test(headerName)) width = 210;
    if (/Photo/.test(headerName)) width = 105;
    if (/Time|Date|Due Date|Last Sync|Pickup Date/.test(headerName)) width = 135;
    if (/Damage|Issue/.test(headerName)) width = 240;
    if (/Status/.test(headerName)) width = 135;
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
  const statusIndex = headers.findIndex(h => h === 'Current Status' || h === 'Status' || h === 'Resolution Status');
  if (statusIndex === -1 || rowCount === 0) {
    sheet.setConditionalFormatRules([]);
    return;
  }

  const range = sheet.getRange(2, statusIndex + 1, rowCount, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Available')
      .setBackground('#dff2e4').setFontColor('#27653b').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Reserved · Awaiting Pickup')
      .setBackground('#fff0c7').setFontColor('#8a5b00').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Borrowed · Return Due')
      .setBackground('#f9d9d6').setFontColor('#9b2e2e').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Awaiting Admin Review')
      .setBackground('#e9ddf3').setFontColor('#684176').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Pending')
      .setBackground('#f9d9d6').setFontColor('#9b2e2e').setBold(true)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Resolved')
      .setBackground('#dff2e4').setFontColor('#27653b').setBold(true)
      .setRanges([range]).build()
  ];
  sheet.setConditionalFormatRules(rules);
}

function statusLabel_(status) {
  const map = {
    available: 'Available',
    reserved: 'Reserved · Awaiting Pickup',
    borrowed: 'Borrowed · Return Due',
    pendingReturn: 'Awaiting Admin Review',
    completed: 'Completed',
    cancelled: 'Cancelled'
  };
  return map[String(status || '')] || String(status || '');
}

function recordTypeLabel_(recordType) {
  const map = {
    return: 'Return Record',
    pickupDamage: 'Issue Found at Pickup'
  };
  return map[String(recordType || '')] || String(recordType || '');
}

function hyperlinkFormula_(url, label) {
  const safeUrl = String(url || '').replace(/"/g, '""');
  const safeLabel = String(label || 'Open').replace(/"/g, '""');
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
