import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FULL_CROP,
  resizeCropToAspect,
} from "../renderer/src/features/infinite-canvas/imageCropGeometry.ts";

// 主进程侧真实素材：3000×4000 竖图 / 4000×3000 横图。
const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 3000, height: 4000 };

/**
 * 主进程 cropAsset 的百分比换算是唯一权威，这里照抄一份用来断言像素结果。
 * 渲染端只上报百分比，所以几何测试的价值就是"百分比对不对"。
 */
function toPixels(crop, size) {
  const ratio = (value) => Math.min(100, Math.max(0, Number(value || 0))) / 100;
  const x = Math.round(ratio(crop.x) * size.width);
  const y = Math.round(ratio(crop.y) * size.height);
  const width = Math.max(1, Math.round(ratio(crop.width) * size.width));
  const height = Math.max(1, Math.round(ratio(crop.height) * size.height));
  return {
    x: Math.min(x, size.width - 1),
    y: Math.min(y, size.height - 1),
    width: Math.min(width, size.width - Math.min(x, size.width - 1)),
    height: Math.min(height, size.height - Math.min(y, size.height - 1)),
  };
}

test("自由比例不改变已经框好的选区", () => {
  const crop = { unit: "%", x: 12.5, y: 20, width: 33, height: 44 };
  assert.deepEqual(resizeCropToAspect(crop, LANDSCAPE.width, LANDSCAPE.height, "free"), crop);
});

test("整图 + 1:1：保留长边并按画布上限收缩", () => {
  const next = resizeCropToAspect(FULL_CROP, LANDSCAPE.width, LANDSCAPE.height, "1:1");
  // 长边 4000 会被 3000 的画布高度裁到 3000，仍然居中。
  assert.deepEqual(toPixels(next, LANDSCAPE), { x: 500, y: 0, width: 3000, height: 3000 });
});

test("切换比例保留裁剪框长边和中心点", () => {
  // 用户已经框好的一块：x=400 y=300 1600×750（横边长边 1600）。
  const crop = { unit: "%", x: 10, y: 10, width: 40, height: 25 };
  const before = toPixels(crop, LANDSCAPE);
  assert.deepEqual(before, { x: 400, y: 300, width: 1600, height: 750 });

  const next = toPixels(resizeCropToAspect(crop, LANDSCAPE.width, LANDSCAPE.height, "1:1"), LANDSCAPE);
  // 长边 1600 保持不变，短边按 1:1 补成 1600。
  assert.equal(next.width, 1600);
  assert.equal(next.height, 1600);
  // 中心点 x 与原来一致（y 被画布上边缘截断）。
  assert.equal(next.x + next.width / 2, before.x + before.width / 2);
  assert.equal(next.y, 0);
});

test("竖版裁剪框换成横版比例时保留竖直长边", () => {
  const crop = { unit: "%", x: 50, y: 0, width: 25, height: 60 }; // 1000×1800
  const next = toPixels(resizeCropToAspect(crop, LANDSCAPE.width, LANDSCAPE.height, "3:2"), LANDSCAPE);
  assert.equal(next.height, 1800);
  assert.equal(next.width, 2700);
  assert.equal(next.x, 1150);
  assert.equal(next.y, 0);
});

test("重复套用同一个比例是稳定的", () => {
  const first = resizeCropToAspect(FULL_CROP, LANDSCAPE.width, LANDSCAPE.height, "2:3");
  const second = resizeCropToAspect(first, LANDSCAPE.width, LANDSCAPE.height, "2:3");
  assert.deepEqual(toPixels(second, LANDSCAPE), toPixels(first, LANDSCAPE));
});

test("任何比例下选区都落在图片内部且不超过画布", () => {
  const aspects = ["original", "1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16"];
  const starts = [
    FULL_CROP,
    { unit: "%", x: 0, y: 0, width: 10, height: 90 },
    { unit: "%", x: 88, y: 70, width: 12, height: 30 },
    { unit: "%", x: 45, y: 45, width: 55, height: 55 },
  ];
  for (const size of [LANDSCAPE, PORTRAIT]) {
    for (const aspect of aspects) {
      for (const start of starts) {
        const rect = toPixels(resizeCropToAspect(start, size.width, size.height, aspect), size);
        assert.ok(rect.x >= 0 && rect.y >= 0, `${aspect} ${JSON.stringify(start)} 越界`);
        assert.ok(rect.x + rect.width <= size.width, `${aspect} 超出宽度`);
        assert.ok(rect.y + rect.height <= size.height, `${aspect} 超出高度`);
        assert.ok(rect.width >= 1 && rect.height >= 1, `${aspect} 选区太小`);
      }
    }
  }
});

test("原始比例等价于图片自身宽高比", () => {
  const next = toPixels(resizeCropToAspect(FULL_CROP, PORTRAIT.width, PORTRAIT.height, "original"), PORTRAIT);
  assert.deepEqual(next, { x: 0, y: 0, width: 3000, height: 4000 });
});
