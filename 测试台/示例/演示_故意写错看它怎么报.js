/**
 * 这个文件里【故意埋了 3 个错】，用来看测试台怎么把它们抓出来。
 * 三个错都是"语法完全正确、静态审读看不出、粘进 Code Editor 也要跑了才知道"的那类。
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
  console.log('      node 跑GEE.js 示例\\' + '演示_故意写错看它怎么报.js');
  console.log('');
  console.log('  或者双击 GEE测试\\跑一个试试.bat 看演示。');
  console.log('  也可以把本文件内容原封不动粘进 code.earthengine.google.com 里点 Run。');
  console.log('');
  throw new Error('请通过 跑GEE.js 运行本脚本');
}

var roi = ee.Geometry.Rectangle([100.60, 24.20, 101.00, 24.60]);

// ❌ 错误 1：波段名写错。Sentinel-2 的近红外是 B8，不是 B08。
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(roi).filterDate('2024-01-01', '2024-04-01').median();
print('错误1 —— 波段名写错：', s2.normalizedDifference(['B08', 'B4']));

// ❌ 错误 2：过滤条件匹配不到，集合是空的。
//    GAUL 里云南叫 'Yunnan Sheng'，写 'Yunnan' 过滤出来是空集。
var 云南 = ee.FeatureCollection('FAO/GAUL_SIMPLIFIED_500m/2015/level1')
  .filter(ee.Filter.eq('ADM1_NAME', 'Yunnan'));
print('错误2 —— 过滤出空集，要素数应为 0：', 云南.size());
print('错误2 —— 空集取 geometry 再 clip：', ee.Image(1).clip(云南.geometry()).bandNames());

// ❌ 错误 3：归约器输入个数不对。
//    sensSlope 需要两个输入（x=时间, y=值），只给一个波段会报错。
var 单波段 = ee.ImageCollection('MODIS/061/MOD13A2')
  .filterDate('2020-01-01', '2021-01-01').select('NDVI');
print('错误3 —— sensSlope 只给一个波段：', 单波段.reduce(ee.Reducer.sensSlope()));
