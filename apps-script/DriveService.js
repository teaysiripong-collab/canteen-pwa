/**
 * Canteen Smart Stock — DriveService.js
 * Upload ไฟล์แนบเข้า Google Drive แล้วคืน File ID + URL
 * ห้ามเก็บ Base64 ลง Google Sheets — Sheet เก็บเฉพาะ File ID / URL
 */

var FOLDER_BY_KIND = {
  'delivery': '02_Receiving & Delivery',
  'waste': '03_Expiry & Waste',
  'po': '04_PO & Pending Delivery',
  'report': '05_Reports',
  'attachment': '06_Attachments'
};

/**
 * API: upload ไฟล์จากหน้าจอ
 * payload = { base64, fileName, mimeType, kind } → { fileId, url }
 */
function apiUploadFile(payload) {
  return apiResult_(function () {
    if (!payload || !payload.base64) throw new Error('ไม่มีไฟล์');
    var folderName = FOLDER_BY_KIND[payload.kind] || FOLDER_BY_KIND.attachment;
    var folderId = PropertiesService.getScriptProperties()
      .getProperty(CFG.PROP.FOLDER_PREFIX + folderName);
    if (!folderId) throw new Error('ไม่พบ folder ' + folderName + ' — กรุณารัน setupSystem()');
    var folder = DriveApp.getFolderById(folderId);

    var bytes = Utilities.base64Decode(payload.base64);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream',
      sanitizeFileName_(payload.fileName || ('upload_' + timestampStr_())));
    var file = folder.createFile(blob);
    return { fileId: file.getId(), url: file.getUrl(), name: file.getName() };
  });
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}
