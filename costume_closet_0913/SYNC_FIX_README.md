# Google Sheet Full Sync Fix

## Root cause
`syncAdminDashboard_()` builds each Inventory row with **15 values**:

1. Costume ID
2. Costume Name
3. Category
4. Size
5. Gender
6. Catalogue Visibility
7. Current Status
8. Current User
9. Pickup Date
10. Due Date
11. Days Overdue
12. Donor
13. Description
14. Photo
15. Last Sync

But the `writeTable_()` call was still using the older **12-column** Inventory header list.

Google Apps Script `setValues()` requires every row to have exactly the same number of columns as the target range. The mismatch caused `syncAdminDashboard_()` to stop at Inventory.

This explains the exact symptom:
- Users could still update first, because `syncUsersSnapshot_()` runs before Inventory.
- Inventory and every dashboard tab after it did not update.

## Fix
The Inventory `writeTable_()` headers now contain the correct 15 columns.

Human-facing reservation sheets are also labeled:
- Preferred Name
- Legal Name

The underlying data fields remain unchanged.

## Install
1. Replace Apps Script `Code.gs` with this file.
2. Save.
3. Run `setup()` once.
4. Deploy → Manage deployments → Edit → New version → Deploy.
5. Return to the admin website.
6. Refresh/log in as admin.
7. Click **Sync Google Sheet** once.
8. Wait a few seconds and refresh the Sheet.

You do NOT need to replace index.html for this fix.
You do NOT need to change Firestore Rules or Cloudinary.
