/**
 * 这个文件可以【原封不动】粘进 code.earthengine.google.com 跑，结果一样。
 * 它用的全是 Code Editor 的 JavaScript 写法：
 *   var 声明、function 关键字、.map(function(){}) 链式调用、
 *   print()、Map.addLayer()、Export —— 这些在 Python 版 GEE 里根本不存在。
 */

// ---------------------------------------------------------------------------
// ★ 这个文件是 **GEE Code Editor 的脚本**，不是独立的 Node 程序。
//   它用到的 ee / print / Map / Export 都由运行环境提供，所以：
//
//     ✗ 直接 node 演示_xxx.js        → 报 "ee is not defined"
//     ✓ node ..\跑GEE.js 演示_xxx.js  → 由测试台把 ee/print/Map/Export 注入进来
//     ✓ 或者原封不动粘进 code.earthengine.google.com 里点 Run
//
//   下面这几行只在"直接用 node 跑"时才会触发，在 Code Editor 里 ee 有定义，
//   等于什么都没做，不影响粘贴使用。
// ---------------------------------------------------------------------------
if (typeof ee === 'undefined') {
  console.log('');
  console.log('  这是 GEE Code Editor 的脚本，不能直接用 node 跑。');
  console.log('');
  console.log('  正确跑法（在 GEE测试 目录下）：');
  console.log('      node 跑GEE.js 示例\\' + '演示_这就是CodeEditor的JS.js');
  console.log('');
  console.log('  或者双击 GEE测试\\跑一个试试.bat 看演示。');
  console.log('  也可以把本文件内容原封不动粘进 code.earthengine.google.com 里点 Run。');
  console.log('');
  throw new Error('请通过 跑GEE.js 运行本脚本');
}

// —— 1. 这是 JS 的 var，不是 Python ——
var roi = ee.Geometry.Rectangle([100.60, 24.20, 101.00, 24.60]);   // 景东
var 起始 = '2024-01-01';

// —— 2. 这是 JS 的 function 与链式 .map()，Python 写法完全不同 ——
function 去云(img) {
  var scl = img.select('SCL');
  var 坏像元 = scl.eq(3).or(scl.eq(8)).or(scl.eq(9)).or(scl.eq(10));
  return img.updateMask(坏像元.not()).divide(10000);
}

var 合成 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(roi)
  .filterDate(起始, '2024-04-01')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
  .map(去云)                       // ← JS 的高阶函数
  .median()
  .clip(roi);

var ndvi = 合成.normalizedDifference(['B8', 'B4']).rename('NDVI');

// —— 3. print / Map / Export：这三个只有 Code Editor 有 ——
print('① 影像景数：', ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(roi).filterDate(起始, '2024-04-01').size());
print('② 合成影像的波段名：', 合成.bandNames());
print('③ NDVI 在研究区的均值：', ndvi.reduceRegion({
  reducer: ee.Reducer.mean(), geometry: roi,
  scale: 100, maxPixels: 1e9, bestEffort: true
}));

Map.centerObject(roi, 11);
Map.addLayer(ndvi, {min: 0, max: 0.9, palette: ['white', 'green']}, 'NDVI 图层');

Export.image.toDrive({
  image: ndvi, description: '演示导出_不会真导',
  region: roi, scale: 30, maxPixels: 1e13
});
