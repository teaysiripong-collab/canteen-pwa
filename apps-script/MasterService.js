/**
 * Canteen Smart Stock — MasterService.js
 * Master data API สำหรับ frontend: Items, Locations, Vendors
 * ส่งเป็นชุดเดียว (bootstrap) เพื่อลดจำนวน round-trip
 */

/** API: โหลด master data ทั้งหมดที่หน้าจอต้องใช้ ใน 1 call */
function apiBootstrap() {
  return apiResult_(function () {
    var items = readAllCached_('ITEM_MASTER')
      .filter(function (it) { return String(it.Active_Status).trim() === 'Active'; })
      .map(function (it) {
        return {
          itemId: it.Item_ID,
          itemCode: it.Item_Code,
          barcode: String(it.Barcode || ''),
          name: it.Item_Name,
          shortName: it.Short_Name,
          category: it.Category,
          unit: it.Main_Unit,
          purchaseUnit: it.Purchase_Unit,
          conversionRate: num_(it.Conversion_Rate),
          vendorMain: it.Vendor_Main,
          lastPrice: num_(it.Last_Price),
          minStock: num_(it.Min_Stock),
          reorderPoint: num_(it.Reorder_Point),
          shelfLifeDay: num_(it.Shelf_Life_Day),
          storageType: it.Storage_Type,
          defaultLocation: it.Default_Location
        };
      });

    var locations = readAllCached_('LOCATION_MASTER')
      .filter(function (l) { return String(l.Active_Status).trim() === 'Active'; })
      .map(function (l) {
        return {
          locationId: l.Location_ID,
          name: l.Location_Name,
          building: l.Building,
          storageType: l.Storage_Type,
          fullPath: l.Full_Path
        };
      });

    var vendors = readAllCached_('VENDOR_MASTER')
      .filter(function (v) { return String(v.Active_Status).trim() === 'Active'; })
      .map(function (v) {
        return { vendorId: v.Vendor_ID, name: v.Vendor_Name, leadTimeDay: num_(v.Lead_Time_Day) };
      });

    // Stock balance สำหรับ autocomplete แสดง current stock
    var balances = {};
    readAll_('STOCK_BALANCE').forEach(function (b) {
      balances[b.Item_ID] = num_(b.Current_Stock);
    });

    return { items: items, locations: locations, vendors: vendors, balances: balances, maxBulkRows: CFG.MAX_BULK_ROWS };
  });
}
