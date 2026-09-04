/**
 * 基于 Sentinel-2 的遥感生态指数 RSEI（Remote Sensing Ecological Index）
 * ============================================================================
 * 研究区：厦门岛及周边（约 230 km²）—— RSEI 提出者徐涵秋团队的经典试验区，
 *        城市 / 植被 / 海面梯度齐全，面积小，交互式一次跑得动。
 * 时相：  2019 与 2024 两期生长季（4—10 月）中值合成，另出变化图 ΔRSEI。
 *
 * ── 方法（Xu Hanqiu, 2013）────────────────────────────────────────────────
 *   RSEI = PC1( f(绿度 NDVI, 湿度 WET, 干度 NDBSI, 热度 LST) )
 *   四个分量各自归一化到 [0,1] → 主成分分析 → 取 PC1 → 再归一化到 [0,1]。
 *   值越大生态质量越好。
 *
 * ── 用 Sentinel-2 做 RSEI，有两处必须讲清楚的近似 ─────────────────────────
 *
 *   ★ 近似 1：热度从哪来
 *     Sentinel-2 **没有热红外波段**，算不出 LST。本脚本用同期 Landsat 8/9
 *     Collection-2 Level-2 的 ST_B10 地表温度产品（30 m）重采样到 20 m 补上。
 *     这是文献里的通行做法，但要承认：热度分量的实际分辨率是 30 m，
 *     不是 S2 的 10/20 m，且两个平台过境时刻不同（S2 约 10:30，Landsat 约 10:30，
 *     同为上午降交点，差异可接受，但不是严格同步观测）。
 *     若研究区在 Landsat 长期多云区，这一步是整个脚本最容易出空洞的地方，
 *     所以下面专门打印了 LST 有效像元覆盖率。
 *
 *   ★ 近似 2：缨帽湿度系数
 *     缨帽变换系数是**传感器专属**的。Sentinel-2 MSI 没有像 Landsat TM/OLI
 *     那样被普遍接受的一套官方系数（Nedkov 2017 提出过一套，但取全部 13 波段，
 *     各文献取值不统一）。本脚本采用文献中最常见的折中：把 Landsat 8 OLI 的
 *     湿度系数套到光谱位置相近的 S2 波段上——
 *         OLI  Blue  Green Red   NIR   SWIR1 SWIR2
 *         S2   B2    B3    B4    B8    B11   B12
 *     这是**近似**，不是严格的 S2 缨帽变换。想换成别的系数，改 CFG.wetCoef 一行即可。
 *     好在 RSEI 后面要做 PCA + 归一化，对湿度分量的绝对尺度不敏感，
 *     但如果你要单独报告 WET 的数值，务必在文中说明系数来源。
 *
 *   ★ 提醒 3：两期可比性
 *     本脚本按标准做法**逐年各做一次 PCA**。严格说两年的 PC1 是两个不同的
 *     线性组合，ΔRSEI 只能作定性判读。要做严格的定量比较，应把两期影像
 *     拼在一起做一次 PCA（用同一套特征向量），代价是计算量翻倍。
 *
 * ── 本脚本调试时踩掉的两个坑（都会"跑通但结果错"，静态审读看不出来）─────────
 *
 *   坑 A：ee.Reducer.centeredCovariance() **不会替你减均值**
 *     它的意思是「对**已经中心化的**数据求协方差」，不是「求中心化的协方差」。
 *     直接喂原始数据，得到的是**未中心化的二阶矩** E[XY]，不是 Cov(X,Y)。
 *     症状：PC1 贡献率虚高到 90%+，四个载荷**全是正号**（因为矩阵被均值的
 *     外积主导，那是个秩 1 的全正矩阵），物理上不可能——NDVI 与 NDBSI
 *     必然强负相关。所以下面 pca4() 里先 subtract(means) 再求协方差。
 *     对账办法：Cov(X,X) 应该等于 stdDev(X)²，一比就露馅。
 *
 *   坑 B：.resample() 不能对 median() 合成影像调用
 *     ImageCollection.median() 返回的影像**没有固定投影**（默认 1 度/像元）。
 *     对它调 .resample() 会强制在那个投影下求值，整个研究区落进一个像元，
 *     LST 直接变成一张常数图（实测 p1 = p99 = 26.841033500）。
 *     再拿去做 min-max 归一化，分母是 1e-11 量级的浮点噪声，结果全是垃圾。
 *     正确做法：resample 放进 map()，对**每一景源影像**做（它们有 30 m 原生投影）。
 *
 * ── 怎么跑 ───────────────────────────────────────────────────────────────
 *   本地：node GEE测试\跑GEE.js --timeout 900 GEE测试\RSEI_哨兵2_厦门岛.js
 *   线上：整个文件原样粘进 code.earthengine.google.com，直接 Run
 *
 * ── 换研究区 ─────────────────────────────────────────────────────────────
 *   只改 CFG.aoi 一行。建议控制在 500 km² 以内，否则 PCA 那步交互式跑不动，
 *   要改走 Export（CFG.doExport = true）。
 * ============================================================================
 */

// ============================================================ 一、参数
var CFG = {
  // 研究区：厦门岛及周边。想换地方只改这一行。
  aoi: ee.Geometry.Rectangle([118.05, 24.42, 118.20, 24.56]),

  years: [2019, 2024],      // 两期对比
  monthStart: 4,            // 生长季起止月（含）
  monthEnd: 10,

  csThresh: 0.60,           // Cloud Score+ 阈值，cs_cdf 大于它才算晴空像元
  s2CloudPct: 80,           // S2 元数据粗筛，先扔掉整景几乎全云的

  scale: 20,                // 成图尺度：受 B11/B12 限制，20 m 是 S2 的自然尺度
  statScale: 60,            // ★ 统计尺度：PCA 协方差、归一化极值、均值都用它。
                            //   统计量本来就是估计值，用 60 m 抽样结果几乎不变，
                            //   但计算量降到 1/9——这是本脚本跑得动的关键。
                            //   研究区放大到 1000 km² 以上时，把这个数一起调大（如 100）。

  // 归一化方式：'percentile' 用 1%/99% 分位数（抗离群值，推荐）
  //             'minmax'     用严格最小/最大值（教材原文做法，易被单个坏像元拉偏）
  normMode: 'percentile',
  pLow: 1,
  pHigh: 99,

  // 缨帽湿度系数（Landsat 8 OLI，套用到 S2 的 B2 B3 B4 B8 B11 B12）
  wetCoef: [0.1511, 0.1973, 0.3283, 0.3407, -0.7117, -0.4559],

  doExport: false           // 改 true 才生成 Export 任务（本地测试台不会真导）
};

var BANDS = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'];   // 蓝 绿 红 近红 短波红外1 短波红外2

// ============================================================ 二、影像合成

/**
 * Sentinel-2 生长季无云中值合成。
 * 用 S2_SR_HARMONIZED：它把 2022-01-25 之后处理基线 04.00 引入的 -1000 偏移
 * 已经改回来了，整个时间序列可以直接除 10000，不用再分段判断。
 * 云掩膜用 Cloud Score+（比 QA60 / SCL 都稳，尤其是薄云和云边缘）。
 */
function s2Composite(year) {
  var start = ee.Date.fromYMD(year, CFG.monthStart, 1);
  var end = ee.Date.fromYMD(year, CFG.monthEnd, 1).advance(1, 'month');

  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(CFG.aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CFG.s2CloudPct));

  var csp = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

  var masked = s2.linkCollection(csp, ['cs_cdf']).map(function (img) {
    var clear = img.select('cs_cdf').gte(CFG.csThresh);
    return img.select(BANDS)
      .updateMask(clear)
      .divide(10000)             // DN → 反射率
      .copyProperties(img, ['system:time_start']);
  });

  return ee.Image(masked.median()).clip(CFG.aoi);
}

/**
 * Landsat 8/9 Collection-2 Level-2 地表温度（°C），同窗口中值。
 * 2019 年只有 L8，2021 年之后 L8+L9，merge 之后为空的那个集合不影响结果。
 */
function lstComposite(year) {
  var start = ee.Date.fromYMD(year, CFG.monthStart, 1);
  var end = ee.Date.fromYMD(year, CFG.monthEnd, 1).advance(1, 'month');

  function prep(img) {
    var qa = img.select('QA_PIXEL');
    // Collection-2 QA_PIXEL：bit1 膨胀云 bit2 卷云 bit3 云 bit4 云影
    var clear = qa.bitwiseAnd(1 << 1).eq(0)
      .and(qa.bitwiseAnd(1 << 2).eq(0))
      .and(qa.bitwiseAnd(1 << 3).eq(0))
      .and(qa.bitwiseAnd(1 << 4).eq(0));
    var lst = img.select('ST_B10')
      // ★ 坑 B：resample 必须在这里对**源影像**做（它有 30 m 原生投影），
      //   放到下面 median() 之后做会把整张图压成常数。详见文件头「坑 B」。
      .resample('bilinear')
      .multiply(0.00341802).add(149.0)   // 官方缩放系数 → 开尔文
      .subtract(273.15)                  // → 摄氏度
      .updateMask(clear)
      .rename('LST');
    return lst;
  }

  var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    .filterBounds(CFG.aoi)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUD_COVER', 80))
    .map(prep);

  return ee.Image(col.median()).clip(CFG.aoi);
}

// ============================================================ 三、四个生态分量

/** 由 S2 合成影像算出 NDVI / WET / NDBSI，并生成水体掩膜 */
function ecoIndices(sr) {
  var b = {
    blue: sr.select('B2'), green: sr.select('B3'), red: sr.select('B4'),
    nir: sr.select('B8'), swir1: sr.select('B11'), swir2: sr.select('B12')
  };

  // ── 绿度
  var ndvi = b.nir.subtract(b.red).divide(b.nir.add(b.red)).rename('NDVI');

  // ── 湿度：缨帽变换第三分量（系数来源见文件头「近似 2」）
  var c = CFG.wetCoef;
  var wet = b.blue.multiply(c[0])
    .add(b.green.multiply(c[1]))
    .add(b.red.multiply(c[2]))
    .add(b.nir.multiply(c[3]))
    .add(b.swir1.multiply(c[4]))
    .add(b.swir2.multiply(c[5]))
    .rename('WET');

  // ── 干度 NDBSI = (SI + IBI) / 2
  //    SI  裸土指数
  var si = b.swir1.add(b.red).subtract(b.nir.add(b.blue))
    .divide(b.swir1.add(b.red).add(b.nir).add(b.blue));
  //    IBI 建筑用地指数（徐涵秋 2008）
  var t1 = b.swir1.multiply(2).divide(b.swir1.add(b.nir));
  var t2 = b.nir.divide(b.nir.add(b.red)).add(b.green.divide(b.green.add(b.swir1)));
  var ibi = t1.subtract(t2).divide(t1.add(t2));
  var ndbsi = si.add(ibi).divide(2).rename('NDBSI');

  // ── 水体掩膜：MNDWI > 0。RSEI 标准流程要求先去水体，
  //    否则水面的高湿度 + 低温会把 PC1 完全带偏（厦门这个区一半是海，必须做）。
  var mndwi = b.green.subtract(b.swir1).divide(b.green.add(b.swir1));
  var land = mndwi.lte(0);

  return { ndvi: ndvi, wet: wet, ndbsi: ndbsi, land: land, mndwi: mndwi.rename('MNDWI') };
}

// ============================================================ 四、归一化与 PCA

// 所有统计类归约共用的参数，保证均值、协方差、极值三者**在同一套像元上算**，
// 否则中心化会用错均值（坑 A 的变体）。
function rr(reducer) {
  return { reducer: reducer, geometry: CFG.aoi, scale: CFG.statScale,
           maxPixels: 1e13, tileScale: 4 };
}

/** 把一个单波段影像线性拉伸到 [0,1]。极值在 statScale 上估计。 */
function normalize(img, name) {
  var reducer = (CFG.normMode === 'minmax')
    ? ee.Reducer.minMax()
    : ee.Reducer.percentile([CFG.pLow, CFG.pHigh]);

  var st = img.reduceRegion(rr(reducer));

  var band = img.bandNames().get(0);
  var lo, hi;
  if (CFG.normMode === 'minmax') {
    lo = ee.Number(st.get(ee.String(band).cat('_min')));
    hi = ee.Number(st.get(ee.String(band).cat('_max')));
  } else {
    lo = ee.Number(st.get(ee.String(band).cat('_p').cat(ee.Number(CFG.pLow).format('%d'))));
    hi = ee.Number(st.get(ee.String(band).cat('_p').cat(ee.Number(CFG.pHigh).format('%d'))));
  }

  return img.subtract(ee.Image.constant(lo))
    .divide(ee.Image.constant(hi.subtract(lo)))
    .clamp(0, 1)                 // 分位数归一化必须 clamp，否则尾部会跑出 [0,1]
    .rename(name);
}

/**
 * 对四个归一化分量做主成分分析，返回 PC1 及诊断信息。
 * 符号约定：PC1 在 NDVI 上的载荷若为负，整体取反，
 * 保证「值大 = 生态好」，与 RSEI 的定义一致。
 */
function pca4(img4) {
  var names = ee.List(['NDVI', 'WET', 'NDBSI', 'LST']);
  var src = img4.select(names);

  // ★ 坑 A：centeredCovariance 不减均值，必须自己先减。
  //   不减的话拿到的是 E[XY] 而不是 Cov(X,Y)，PC1 会被均值外积主导，
  //   表现为「贡献率 90%+ 且四个载荷全正号」。详见文件头「坑 A」。
  var means = ee.Image.constant(src.reduceRegion(rr(ee.Reducer.mean())).values(names));
  var centered = src.subtract(means).rename(names);

  var arr = centered.toArray();
  var covar = arr.reduceRegion(rr(ee.Reducer.centeredCovariance()));  // ★ 粗尺度，成图尺度跑不动

  var covArr = ee.Array(covar.get('array'));          // 4×4
  var eigen = covArr.eigen();                          // 4×5：第 0 列特征值，后 4 列特征向量
  var eigenVal = eigen.slice(1, 0, 1).project([0]);    // 长度 4，已按降序
  var eigenVec = eigen.slice(1, 1);                    // 4×4，每一**行**是一个特征向量

  // PC1 在 NDVI（第 0 个分量）上的载荷，用来定符号
  var signPC1 = ee.Number(ee.Algorithms.If(
    ee.Number(eigenVec.get([0, 0])).lt(0), -1, 1));

  var pcs = ee.Image(eigenVec)
    .matrixMultiply(arr.toArray(1))                    // (4×4)·(4×1) = 4×1
    .arrayProject([0])
    .arrayFlatten([['pc1', 'pc2', 'pc3', 'pc4']]);

  var pc1 = pcs.select('pc1').multiply(ee.Image.constant(signPC1)).rename('PC1');

  var total = eigenVal.reduce(ee.Reducer.sum(), [0]).get([0]);
  var contrib = eigenVal.divide(total);                // 各主成分贡献率

  return {
    pc1: pc1,
    contrib: contrib,
    // 载荷取过符号，直接可读：正=对生态质量正贡献
    loadings: eigenVec.slice(0, 0, 1).project([1]).multiply(signPC1),
    names: names
  };
}

// ============================================================ 五、单期 RSEI

function rseiOfYear(year) {
  var sr = s2Composite(year);
  var idx = ecoIndices(sr);
  var lst = lstComposite(year).rename('LST');

  // 三个 S2 分量共享水体掩膜；LST 还要叠上它自己的有效范围（云掩膜后可能有空洞）
  var mask = idx.land.and(lst.mask());

  var raw = ee.Image.cat([idx.ndvi, idx.wet, idx.ndbsi, lst]).updateMask(mask);

  var norm = ee.Image.cat([
    normalize(raw.select('NDVI'), 'NDVI'),
    normalize(raw.select('WET'), 'WET'),
    normalize(raw.select('NDBSI'), 'NDBSI'),
    normalize(raw.select('LST'), 'LST')
  ]).updateMask(mask);

  var p = pca4(norm);
  var rsei = normalize(p.pc1, 'RSEI').updateMask(mask);

  return {
    year: year, sr: sr, raw: raw, norm: norm, rsei: rsei,
    mask: mask, mndwi: idx.mndwi, lst: lst,
    contrib: p.contrib, loadings: p.loadings, names: p.names
  };
}

// ============================================================ 六、跑两期

var A = rseiOfYear(CFG.years[0]);
var B = rseiOfYear(CFG.years[1]);

// ---- 体检 1：数据可用性。这几行不对，后面的结论一概不用看。
print('研究区面积(km²)：', CFG.aoi.area(1).divide(1e6));
print(CFG.years[0] + ' RSEI 有效像元占全区比例（海面已被掩掉，所以不该是 1）：',
  A.rsei.mask().reduceRegion(rr(ee.Reducer.mean())));
print(CFG.years[1] + ' RSEI 有效像元占全区比例：',
  B.rsei.mask().reduceRegion(rr(ee.Reducer.mean())));

// ---- 体检 2：四个原始分量的 p1/p50/p99。
//      ★ 专门为了抓「坑 B」那类事故：某个分量若 p1 ≈ p99，说明它已经退化成常数，
//        后面的归一化会拿 1e-11 量级的分母去除，整条链的结果全是垃圾——
//        而脚本照样"跑通、无报错"。所以这一行必须看。
print(CFG.years[0] + ' 原始分量 p1/p50/p99：',
  A.raw.reduceRegion(rr(ee.Reducer.percentile([1, 50, 99]))));
print(CFG.years[1] + ' 原始分量 p1/p50/p99：',
  B.raw.reduceRegion(rr(ee.Reducer.percentile([1, 50, 99]))));

// ---- PCA 诊断：贡献率与载荷，这是 RSEI 论文必报的两张表。
//      ★ 载荷的**符号模式**是最好的自检：正常应为 NDVI +、WET +、NDBSI −、LST −。
//        若四个全同号，回头看文件头「坑 A」。
print(CFG.years[0] + ' 各主成分贡献率 [PC1..PC4]：', A.contrib);
print(CFG.years[0] + ' PC1 载荷 [NDVI, WET, NDBSI, LST]：', A.loadings);
print(CFG.years[1] + ' 各主成分贡献率 [PC1..PC4]：', B.contrib);
print(CFG.years[1] + ' PC1 载荷 [NDVI, WET, NDBSI, LST]：', B.loadings);

// ---- 四分量与 RSEI 的区域均值
print(CFG.years[0] + ' 归一化分量与 RSEI 均值：',
  A.norm.addBands(A.rsei).reduceRegion(rr(ee.Reducer.mean())));
print(CFG.years[1] + ' 归一化分量与 RSEI 均值：',
  B.norm.addBands(B.rsei).reduceRegion(rr(ee.Reducer.mean())));

// ---- 生态等级面积（差/较差/中等/良/优，各 0.2 一档）
function gradeArea(r) {
  var grade = r.rsei.multiply(5).ceil().clamp(1, 5).toInt().rename('grade');
  return ee.Image.pixelArea().divide(1e6).addBands(grade).reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'grade' }),
    geometry: CFG.aoi, scale: CFG.scale, maxPixels: 1e13, tileScale: 4
  });
}
print(CFG.years[0] + ' 各等级面积 km²（1差 2较差 3中等 4良 5优）：', gradeArea(A));
print(CFG.years[1] + ' 各等级面积 km²：', gradeArea(B));

// ---- 变化
var dRSEI = B.rsei.subtract(A.rsei).rename('dRSEI');
print('ΔRSEI（' + CFG.years[1] + ' − ' + CFG.years[0] + '）均值：',
  dRSEI.reduceRegion(rr(ee.Reducer.mean())));

// ============================================================ 七、出图

var visRSEI = { min: 0, max: 1, palette: ['a50026', 'f46d43', 'fee08b', 'a6d96a', '1a9850'] };
var visD = { min: -0.3, max: 0.3, palette: ['d73027', 'f7f7f7', '1a9850'] };

Map.centerObject(CFG.aoi, 12);
Map.addLayer(A.sr, { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.25 }, CFG.years[0] + ' 真彩色', false);
Map.addLayer(B.sr, { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.25 }, CFG.years[1] + ' 真彩色', false);
Map.addLayer(A.norm.select('NDVI'), { min: 0, max: 1, palette: ['white', 'green'] }, CFG.years[0] + ' 绿度', false);
Map.addLayer(A.norm.select('WET'), { min: 0, max: 1, palette: ['white', 'blue'] }, CFG.years[0] + ' 湿度', false);
Map.addLayer(A.norm.select('NDBSI'), { min: 0, max: 1, palette: ['white', 'brown'] }, CFG.years[0] + ' 干度', false);
Map.addLayer(A.norm.select('LST'), { min: 0, max: 1, palette: ['white', 'red'] }, CFG.years[0] + ' 热度', false);
Map.addLayer(A.rsei, visRSEI, CFG.years[0] + ' RSEI');
Map.addLayer(B.rsei, visRSEI, CFG.years[1] + ' RSEI');
Map.addLayer(dRSEI, visD, 'ΔRSEI 变化');

// ============================================================ 八、导出（默认关闭）
if (CFG.doExport) {
  [A, B].forEach(function (r) {
    Export.image.toDrive({
      image: r.rsei.multiply(10000).toInt16(),   // 转整型省体积，用时除 10000
      description: 'RSEI_S2_' + r.year,
      folder: 'GEE_RSEI',
      region: CFG.aoi,
      scale: CFG.scale,
      crs: 'EPSG:4326',
      maxPixels: 1e13
    });
  });
  Export.image.toDrive({
    image: dRSEI.multiply(10000).toInt16(),
    description: 'RSEI_S2_delta_' + CFG.years[0] + '_' + CFG.years[1],
    folder: 'GEE_RSEI',
    region: CFG.aoi,
    scale: CFG.scale,
    crs: 'EPSG:4326',
    maxPixels: 1e13
  });
}
