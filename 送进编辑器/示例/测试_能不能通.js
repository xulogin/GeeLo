/**
 * 一键开 GEE · 通路自检
 * ----------------------------------------------------------------------------
 * 到了新电脑，先右键这个文件 →「以 GEE 打开」。
 *
 * 只要 Code Editor 打开后**编辑器里出现的是这段代码**，就说明整条链路通了：
 *   本地文件 → git push → EE 脚本仓库 → ?scriptPath= → 你的 Chrome
 *
 * 代码本身极轻（只取一景影像的波段名），点 Run 一两秒就出结果，
 * 顺带验证这个账号的 GEE 也是通的。
 *
 * 验完就可以删掉本文件，或者留着下次换电脑再用。
 */

var 点 = ee.Geometry.Point([118.10, 24.48]);   // 厦门岛

var 影像 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(点)
  .filterDate('2024-06-01', '2024-09-30')
  .first();

print('① 如果你能在编辑器里看到这段代码，链路就通了。');
print('② 影像 ID：', 影像.get('system:index'));
print('③ 波段名：', 影像.bandNames());

Map.centerObject(点, 11);
Map.addLayer(影像, { bands: ['B4', 'B3', 'B2'], min: 0, max: 3000 }, '真彩色');
