/**
 * Canteen Smart Stock — Code.js
 * Web App entry point + HTML include helper
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Canteen Smart Stock')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** รวมไฟล์ HTML ย่อย (CSS/JS) เข้า template หลัก */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
