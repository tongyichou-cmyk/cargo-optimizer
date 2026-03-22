/**
 * Unit Tests — Cargo Optimizer v1.4
 * Node.js (no npm), using built-in assert
 */
import assert from 'assert/strict';

// ─── Replicate constants & pure functions from container-loader.html ───

const CONTS = {
  '20ft': { name:'20呎標準櫃', l:589,  w:235, h:239, maxWt:28000 },
  '40ft': { name:'40呎標準櫃', l:1200, w:235, h:239, maxWt:26500 },
  '40hc': { name:'40呎高櫃',   l:1200, w:235, h:269, maxWt:26500 },
};

const VENDOR_PALETTES = {
  'A': ['#FF6B35','#FF9500','#FFCC02','#FF8C42','#E8531F'],
  'B': ['#007AFF','#5856D6','#00BCD4','#5AC8FA','#34AADC'],
  'C': ['#34C759','#4CD964','#00C853','#8BC34A','#2ECC71'],
  'D': ['#FF2D55','#FF375F','#F72585','#E91E63','#C2185B'],
  'E': ['#BF5AF2','#9B59B6','#A855F7','#7C3AED','#6D28D9'],
};
const DEFAULT_PALETTE = ['#FF6B35','#007AFF','#34C759','#FF2D55','#BF5AF2','#FF9500','#5AC8FA','#8BC34A'];

function rebuildColors(items) {
  const vendorIdx = {};
  items.forEach(item => {
    const v = String(item.vendor || 'A').toUpperCase();
    if (vendorIdx[v] === undefined) vendorIdx[v] = 0;
    const palette = VENDOR_PALETTES[v] || DEFAULT_PALETTE;
    item.color = palette[vendorIdx[v]++ % palette.length];
  });
}

function getRotations(box) {
  const { l, w, h, dir } = box;
  const rotations = [];
  if (dir === 'fixed') {
    rotations.push({ bl: l, bh: h, bw: w });
  } else if (dir === 'up') {
    rotations.push({ bl: l, bh: h, bw: w });
    rotations.push({ bl: w, bh: h, bw: l });
  } else {
    rotations.push({ bl: l, bh: h, bw: w });
    rotations.push({ bl: w, bh: h, bw: l });
    rotations.push({ bl: l, bh: w, bw: h });
    rotations.push({ bl: h, bh: w, bw: l });
    rotations.push({ bl: h, bh: l, bw: w });
    rotations.push({ bl: w, bh: l, bw: h });
  }
  return rotations;
}

function hasOverlap(placed, x, y, z, l, h, w) {
  const eps = 0.001;
  for (const b of placed) {
    if (x + l > b.px + eps && b.px + b.pl > x + eps &&
        y + h > b.py + eps && b.py + b.ph > y + eps &&
        z + w > b.pz + eps && b.pz + b.pw > z + eps) {
      return true;
    }
  }
  return false;
}

function isSupported(placed, x, y, z, l, w) {
  const eps = 0.1;
  for (const b of placed) {
    if (Math.abs(b.py + b.ph - y) < eps) {
      const ox = Math.min(x + l, b.px + b.pl) - Math.max(x, b.px);
      const oz = Math.min(z + w, b.pz + b.pw) - Math.max(z, b.pz);
      if (ox > 0.1 && oz > 0.1) return true;
    }
  }
  return false;
}

function getBoxesBelow(placed, x, y, z, l, w) {
  return placed.filter(b => {
    if (Math.abs(b.py + b.ph - y) > 0.1) return false;
    const ox = Math.min(x+l, b.px+b.pl) - Math.max(x, b.px);
    const oz = Math.min(z+w, b.pz+b.pw) - Math.max(z, b.pz);
    return ox > 0.1 && oz > 0.1;
  });
}

function getStackHeight(placed, x, z, l, w, box) {
  return placed.filter(b => {
    if (box !== undefined && b.origId !== box.origId) return false;
    const ox = Math.min(x+l, b.px+b.pl) - Math.max(x, b.px);
    const oz = Math.min(z+w, b.pz+b.pw) - Math.max(z, b.pz);
    return ox > 0.1 && oz > 0.1;
  }).length;
}

function packEPRange(boxes, placedAll, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax, seedEps) {
  const placed = [], unplaced = [];
  let eps;
  if (seedEps && seedEps.length) {
    eps = seedEps.filter(e => e.x >= xMin - 0.001 && e.x <= xMax && e.y <= CH && e.z <= CW);
    if (!eps.length) eps = [{ x: xMin, y: 0, z: 0 }];
  } else {
    eps = [{ x: xMin, y: 0, z: 0 }];
  }

  for (const box of boxes) {
    const rotations = getRotations(box);
    let best = null, bestScore = Infinity;
    for (const ep of eps) {
      for (const rot of rotations) {
        const { bl, bh, bw } = rot;
        const x = ep.x, y = ep.y, z = ep.z;
        if (x < xMin - 0.001 || x + bl > xMax + 0.001) continue;
        if (z + bw > CW + 0.001 || y + bh > CH + 0.001) continue;
        if (totalWt + box.wt > maxWt) continue;
        const zoneIdx = Math.min(2, Math.floor(x / zoneL));
        if (zoneWt[zoneIdx] + box.wt > maxZoneWt) continue;
        const all = placedAll.concat(placed);
        if (hasOverlap(all, x, y, z, bl, bh, bw)) continue;
        if (y > 0.001 && !isSupported(all, x, y, z, bl, bw)) continue;
        if (y > 0.001) {
          const below = getBoxesBelow(all, x, y, z, bl, bw);
          if (below.some(b => b.stack === 'no')) continue;
          if (below.some(b => b.stack === 'yes' && b.maxStack !== undefined)) {
            const maxH = Math.max(...below.filter(b => b.stack === 'yes').map(b => b.maxStack || 99));
            if (getStackHeight(all, x, z, bl, bw, box) >= maxH) continue;
          }
        }
        const score = x * 1e10 + y * 1e5 + z;
        if (score < bestScore) { bestScore = score; best = { x, y, z, bl, bh, bw }; }
      }
    }
    if (best) {
      const zoneIdx = Math.min(2, Math.floor(best.x / zoneL));
      zoneWt[zoneIdx] += box.wt; totalWt += box.wt;
      placed.push({ ...box, px: best.x, py: best.y, pz: best.z, pl: best.bl, ph: best.bh, pw: best.bw });
      [{ x: best.x+best.bl, y: best.y, z: best.z },
       { x: best.x, y: best.y+best.bh, z: best.z },
       { x: best.x, y: best.y, z: best.z+best.bw }].forEach(ep => {
        if (ep.x <= xMax && ep.y <= CH && ep.z <= CW)
          if (!eps.some(e => Math.abs(e.x-ep.x)<0.1 && Math.abs(e.y-ep.y)<0.1 && Math.abs(e.z-ep.z)<0.1))
            eps.push(ep);
      });
    } else { unplaced.push(box); }
  }
  return { placed, unplaced, totalWt };
}

// Estimate minimum x-length a vendor's boxes need (using default rotation = first rotation,
// which matches what the packing algorithm picks when scores are equal)
function computeMinZone(boxes, CW, CH) {
  const skus = {};
  boxes.forEach(b => {
    const k = b.origId || b.id;
    if (!skus[k]) skus[k] = { box: b, qty: 0 };
    skus[k].qty++;
  });
  let total = 0;
  Object.values(skus).forEach(({ box, qty }) => {
    const { bl, bh, bw } = getRotations(box)[0];  // first rotation matches algorithm default
    const zSlots = Math.floor(CW / bw);
    const yStacks = Math.min(box.maxStack || 99, Math.floor(CH / bh));
    if (!zSlots || !yStacks) return;
    total += Math.ceil(qty / (zSlots * yStacks)) * bl;
  });
  return total;
}

// Brute-force placement: scan all x/y/z boundaries for valid positions.
// Used as last-resort for stubborn leftovers that EP heuristic misses.
function packBruteForce(boxes, placedAll, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax) {
  const placed = [], unplaced = [];
  for (const box of boxes) {
    const rotations = getRotations(box);
    let best = null, bestScore = Infinity;
    const all = placedAll.concat(placed);
    // Candidate positions: all boundaries created by placed boxes
    const xs = [...new Set([xMin, ...all.map(b => b.px), ...all.map(b => b.px+b.pl)])].filter(x => x >= xMin-0.001 && x <= xMax).sort((a,b)=>a-b);
    const ys = [...new Set([0, ...all.map(b => b.py+b.ph)])].sort((a,b)=>a-b);
    const zs = [...new Set([0, ...all.map(b => b.pz), ...all.map(b => b.pz+b.pw)])].filter(z => z >= 0 && z <= CW).sort((a,b)=>a-b);
    for (const x of xs) {
      for (const rot of rotations) {
        const { bl, bh, bw } = rot;
        if (x < xMin-0.001 || x + bl > xMax+0.001) continue;
        for (const y of ys) {
          if (y + bh > CH+0.001) continue;
          for (const z of zs) {
            if (z + bw > CW+0.001) continue;
            if (totalWt + box.wt > maxWt) continue;
            const zoneIdx = Math.min(2, Math.floor(x / zoneL));
            if (zoneWt[zoneIdx] + box.wt > maxZoneWt) continue;
            if (hasOverlap(all, x, y, z, bl, bh, bw)) continue;
            if (y > 0.001 && !isSupported(all, x, y, z, bl, bw)) continue;
            if (y > 0.001) {
              const below = getBoxesBelow(all, x, y, z, bl, bw);
              if (below.some(b => b.stack === 'no')) continue;
              if (below.some(b => b.stack === 'yes' && b.maxStack !== undefined)) {
                const maxH = Math.max(...below.filter(b => b.stack === 'yes').map(b => b.maxStack || 99));
                if (getStackHeight(all, x, z, bl, bw, box) >= maxH) continue;
              }
            }
            const score = x * 1e10 + y * 1e5 + z;
            if (score < bestScore) { bestScore = score; best = { x, y, z, bl, bh, bw }; }
          }
        }
      }
    }
    if (best) {
      const zoneIdx = Math.min(2, Math.floor(best.x / zoneL));
      zoneWt[zoneIdx] += box.wt; totalWt += box.wt;
      placed.push({ ...box, px: best.x, py: best.y, pz: best.z, pl: best.bl, ph: best.bh, pw: best.bw });
    } else { unplaced.push(box); }
  }
  return { placed, unplaced, totalWt };
}

function packEP(itemList, contSpec) {
  const { l: CL, w: CW, h: CH, maxWt } = contSpec;
  const zoneWt = [0, 0, 0], zoneL = CL / 3, maxZoneWt = maxWt * 0.6;

  const noStackItems = itemList.filter(it => it.stack === 'no');
  const stackItems   = itemList.filter(it => it.stack !== 'no');
  const vendorOrder = [], vendorBoxes = {}, vendorVol = {};
  const skuQty = {};
  itemList.forEach(it => { skuQty[it.id] = it.qty; });

  stackItems.forEach(it => {
    const v = String(it.vendor || 'A').toUpperCase();
    if (!vendorBoxes[v]) { vendorBoxes[v] = []; vendorVol[v] = 0; vendorOrder.push(v); }
    for (let i = 0; i < it.qty; i++) vendorBoxes[v].push({ ...it, id: it.id+'_'+i, origId: it.id });
    vendorVol[v] += it.qty * it.l * it.w * it.h;
  });
  vendorOrder.sort();
  vendorOrder.forEach(v => {
    vendorBoxes[v].sort((a, b) => {
      const qa = skuQty[a.origId]||0, qb = skuQty[b.origId]||0;
      if (qb !== qa) return qb - qa;
      if (b.h !== a.h) return b.h - a.h;
      return (b.l*b.w*b.h) - (a.l*a.w*a.h);
    });
  });

  const noStackBoxes = [];
  noStackItems.forEach(it => { for (let i=0;i<it.qty;i++) noStackBoxes.push({...it,id:it.id+'_'+i,origId:it.id}); });

  const totalVol = vendorOrder.reduce((s,v) => s+vendorVol[v], 0);
  const xBounds = {};
  let xCur = 0;
  // Reserve minimum zone for last vendor; give remainder to earlier vendors proportionally.
  // Zone allocation uses CL (full container) to preserve original zone sizing;
  // effL (door clearance) is enforced as the hard placement boundary.
  const lastV = vendorOrder.length ? vendorOrder[vendorOrder.length - 1] : null;
  const lastMinZone = lastV ? computeMinZone(vendorBoxes[lastV], CW, CH) : 0;
  const availableForNonLast = Math.max(0, CL - lastMinZone);
  const nonLastVol = vendorOrder.slice(0, -1).reduce((s, v) => s + vendorVol[v], 0);
  vendorOrder.forEach((v, i) => {
    if (i === vendorOrder.length-1) { xBounds[v] = [xCur, CL]; }
    else {
      const len = nonLastVol > 0
        ? Math.ceil(availableForNonLast * (vendorVol[v] / nonLastVol))
        : Math.ceil(CL * (vendorVol[v]/totalVol) * 1.05);
      xBounds[v] = [xCur, Math.min(xCur+len, CL)];
      xCur = xBounds[v][1];
    }
  });

  const mkEps = (placed) => {
    const eps = [];
    placed.forEach(b => {
      [{ x:b.px+b.pl,y:b.py,z:b.pz },{ x:b.px,y:b.py+b.ph,z:b.pz },{ x:b.px,y:b.py,z:b.pz+b.pw }]
      .forEach(ep => {
        if (ep.x<=CL && ep.y<=CH && ep.z<=CW &&
            !eps.some(e=>Math.abs(e.x-ep.x)<0.1&&Math.abs(e.y-ep.y)<0.1&&Math.abs(e.z-ep.z)<0.1))
          eps.push(ep);
      });
    });
    return eps;
  };

  let allPlaced = [], leftover = [], totalWt = 0;
  if (noStackBoxes.length) {
    noStackBoxes.sort((a,b)=>(b.wt-a.wt)||((b.l*b.w*b.h)-(a.l*a.w*a.h)));
    const r = packEPRange(noStackBoxes, allPlaced, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, 0, CL);
    allPlaced = allPlaced.concat(r.placed); leftover = leftover.concat(r.unplaced); totalWt = r.totalWt;
  }

  const vendorLeftover = {};
  vendorOrder.forEach(v => {
    const [xMin, xMax] = xBounds[v];
    const skuMap = {};
    vendorBoxes[v].forEach(b => { if (!skuMap[b.origId]) skuMap[b.origId] = []; skuMap[b.origId].push(b); });
    const skuKeys = Object.keys(skuMap).sort((a, b) => {
      const qa = skuMap[a].length, qb = skuMap[b].length;
      if (qb !== qa) return qb - qa;
      if (skuMap[b][0].h !== skuMap[a][0].h) return skuMap[b][0].h - skuMap[a][0].h;
      return (skuMap[b][0].l*skuMap[b][0].w*skuMap[b][0].h) - (skuMap[a][0].l*skuMap[a][0].w*skuMap[a][0].h);
    });
    const vLeftover = [];
    skuKeys.forEach(k => {
      const r = packEPRange(skuMap[k], allPlaced, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax);
      allPlaced = allPlaced.concat(r.placed); totalWt = r.totalWt;
      if (r.unplaced.length) {
        const r2 = packEPRange(r.unplaced, allPlaced, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax, mkEps(allPlaced));
        allPlaced = allPlaced.concat(r2.placed); totalWt = r2.totalWt;
        vLeftover.push(...r2.unplaced);
      }
    });
    vendorLeftover[v] = vLeftover;
  });

  // Per-vendor final cleanup: fill any remaining gaps
  vendorOrder.forEach(v => {
    if (!vendorLeftover[v].length) return;
    const [xMin, xMax] = xBounds[v];
    const r = packEPRange(vendorLeftover[v], allPlaced, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax, mkEps(allPlaced));
    allPlaced = allPlaced.concat(r.placed); vendorLeftover[v] = r.unplaced; totalWt = r.totalWt;
  });

  // Brute-force pass: last resort for stubborn leftovers (scan all boundary positions)
  vendorOrder.forEach(v => {
    if (!vendorLeftover[v].length) return;
    const [xMin, xMax] = xBounds[v];
    const r = packBruteForce(vendorLeftover[v], allPlaced, totalWt, zoneWt, zoneL, maxZoneWt, CL, CW, CH, maxWt, xMin, xMax);
    allPlaced = allPlaced.concat(r.placed); vendorLeftover[v] = r.unplaced; totalWt = r.totalWt;
  });

  leftover = leftover.concat(vendorOrder.flatMap(v => vendorLeftover[v]));

  const placed = allPlaced, unplaced = leftover;
  const usedVol = placed.reduce((s,b) => s+b.pl*b.ph*b.pw, 0);
  const contVol = CL * CW * CH;
  const maxX = placed.length ? Math.max(...placed.map(b => b.px + b.pl)) : 0;
  const doorClearance = Math.max(0, CL - maxX);
  return { placed, unplaced, totalWt, usedVol, volRate: usedVol/contVol, wtRate: totalWt/maxWt, doorClearance };
}

// ─── Test runner ───
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); passed++; }
  catch (e) { console.log(`  ❌  ${name}\n     → ${e.message}`); failed++; }
}

// ══════════════════════════════════════════════
console.log('\n🧪  getRotations()\n');

test('fixed dir → 1 rotation', () => {
  const rots = getRotations({ l:60, w:40, h:35, dir:'fixed' });
  assert.equal(rots.length, 1);
  assert.deepEqual(rots[0], { bl:60, bh:35, bw:40 });
});

test('up dir → 2 rotations, height preserved', () => {
  const rots = getRotations({ l:60, w:40, h:35, dir:'up' });
  assert.equal(rots.length, 2);
  rots.forEach(r => assert.equal(r.bh, 35, 'height must stay 35 for up-dir'));
});

test('free dir → 6 rotations', () => {
  const rots = getRotations({ l:60, w:40, h:35, dir:'free' });
  assert.equal(rots.length, 6);
});

test('free dir: all rotations use same 3 dimensions', () => {
  const rots = getRotations({ l:60, w:40, h:35, dir:'free' });
  rots.forEach(r => {
    const dims = [r.bl, r.bh, r.bw].sort((a,b)=>a-b);
    assert.deepEqual(dims, [35, 40, 60]);
  });
});

test('cube → all 6 rotations identical dimensions', () => {
  const rots = getRotations({ l:50, w:50, h:50, dir:'free' });
  assert.equal(rots.length, 6);
  rots.forEach(r => {
    assert.equal(r.bl, 50);
    assert.equal(r.bh, 50);
    assert.equal(r.bw, 50);
  });
});

// ══════════════════════════════════════════════
console.log('\n🧪  hasOverlap()\n');

test('no placed boxes → no overlap', () => {
  assert.equal(hasOverlap([], 0, 0, 0, 50, 50, 50), false);
});

test('identical position → overlap', () => {
  const placed = [{ px:0, py:0, pz:0, pl:50, ph:50, pw:50 }];
  assert.equal(hasOverlap(placed, 0, 0, 0, 50, 50, 50), true);
});

test('adjacent (touching) → no overlap', () => {
  const placed = [{ px:0, py:0, pz:0, pl:50, ph:50, pw:50 }];
  assert.equal(hasOverlap(placed, 50, 0, 0, 50, 50, 50), false);
});

test('partial overlap in X → overlap', () => {
  const placed = [{ px:0, py:0, pz:0, pl:50, ph:50, pw:50 }];
  assert.equal(hasOverlap(placed, 25, 0, 0, 50, 50, 50), true);
});

test('above box → no overlap', () => {
  const placed = [{ px:0, py:0, pz:0, pl:50, ph:50, pw:50 }];
  assert.equal(hasOverlap(placed, 0, 50, 0, 50, 50, 50), false);
});

test('multiple placed boxes, new box fits in gap', () => {
  const placed = [
    { px:0,   py:0, pz:0, pl:50, ph:50, pw:50 },
    { px:100, py:0, pz:0, pl:50, ph:50, pw:50 },
  ];
  assert.equal(hasOverlap(placed, 50, 0, 0, 50, 50, 50), false);
});

// ══════════════════════════════════════════════
console.log('\n🧪  isSupported()\n');

test('floor (y=0) → supported by default (not called)', () => {
  // isSupported is only called when y > 0
  // At y=0, anything is on the floor — test it still returns false since no box there
  assert.equal(isSupported([], 0, 0, 0, 50, 50), false);
});

test('box on top of another → supported', () => {
  const placed = [{ px:0, py:0, pz:0, pl:60, ph:40, pw:60 }];
  assert.equal(isSupported(placed, 0, 40, 0, 60, 60), true);
});

test('box beside (not below) → not supported', () => {
  const placed = [{ px:0, py:0, pz:0, pl:50, ph:40, pw:50 }];
  assert.equal(isSupported(placed, 60, 40, 0, 50, 50), false);
});

test('partial overlap still supports', () => {
  const placed = [{ px:0, py:0, pz:0, pl:60, ph:40, pw:60 }];
  // New box at y=40, partially overlapping base box
  assert.equal(isSupported(placed, 30, 40, 30, 60, 60), true);
});

// ══════════════════════════════════════════════
console.log('\n🧪  rebuildColors()\n');

test('vendor A gets warm color', () => {
  const items = [{ vendor:'A' }, { vendor:'A' }];
  rebuildColors(items);
  assert.equal(items[0].color, VENDOR_PALETTES['A'][0]);
  assert.equal(items[1].color, VENDOR_PALETTES['A'][1]);
});

test('vendor B gets cool color', () => {
  const items = [{ vendor:'B' }];
  rebuildColors(items);
  assert.equal(items[0].color, VENDOR_PALETTES['B'][0]);
});

test('different vendors get different colors', () => {
  const items = [{ vendor:'A' }, { vendor:'B' }];
  rebuildColors(items);
  assert.notEqual(items[0].color, items[1].color);
});

test('unknown vendor falls back to default palette', () => {
  const items = [{ vendor:'Z' }];
  rebuildColors(items);
  assert.equal(items[0].color, DEFAULT_PALETTE[0]);
});

test('vendor indices are independent per vendor', () => {
  const items = [{ vendor:'A' }, { vendor:'B' }, { vendor:'A' }];
  rebuildColors(items);
  // items[0] and items[2] are both vendor A, sequential colors
  assert.equal(items[0].color, VENDOR_PALETTES['A'][0]);
  assert.equal(items[2].color, VENDOR_PALETTES['A'][1]);
  // items[1] is vendor B, gets B's first color
  assert.equal(items[1].color, VENDOR_PALETTES['B'][0]);
});

test('palette wraps around when more items than colors', () => {
  const items = Array.from({length:6}, () => ({ vendor:'A' }));
  rebuildColors(items);
  assert.equal(items[5].color, VENDOR_PALETTES['A'][5 % VENDOR_PALETTES['A'].length]);
});

test('missing vendor defaults to A palette', () => {
  const items = [{ }];
  rebuildColors(items);
  assert.equal(items[0].color, VENDOR_PALETTES['A'][0]);
});

// ══════════════════════════════════════════════
console.log('\n🧪  packEP() — basic packing\n');

const c20 = CONTS['20ft'];
const c40 = CONTS['40ft'];

test('single small box fits in container', () => {
  const items = [{ id:1, vendor:'A', l:50, w:50, h:50, wt:10, qty:1, dir:'free', stack:'yes', maxStack:3 }];
  const r = packEP(items, c20);
  assert.equal(r.placed.length, 1);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.totalWt, 10);
});

test('box too large for container → unplaced', () => {
  const items = [{ id:1, vendor:'A', l:600, w:236, h:240, wt:100, qty:1, dir:'fixed', stack:'yes', maxStack:3 }];
  const r = packEP(items, c20);
  assert.equal(r.placed.length, 0);
  assert.equal(r.unplaced.length, 1);
});

test('multiple boxes all fit', () => {
  const items = [
    { id:1, vendor:'A', l:100, w:100, h:100, wt:10, qty:5, dir:'free', stack:'yes', maxStack:5 },
  ];
  const r = packEP(items, c20);
  assert.equal(r.placed.length, 5);
  assert.equal(r.unplaced.length, 0);
});

test('weight limit exceeded → some boxes unplaced', () => {
  // Single box per item, weight just under limit in pairs
  const heavyWt = 15000;
  const items = [
    { id:1, vendor:'A', l:50, w:50, h:50, wt: heavyWt, qty:3, dir:'free', stack:'yes', maxStack:3 },
  ];
  const r = packEP(items, c20); // maxWt=28000
  assert.ok(r.totalWt <= c20.maxWt, `Total weight ${r.totalWt} exceeds maxWt ${c20.maxWt}`);
  assert.ok(r.unplaced.length > 0, 'Some boxes should be unplaced due to weight');
});

test('no-stack boxes placed first (before stackable)', () => {
  const items = [
    { id:1, vendor:'A', l:50, w:50, h:50, wt:5, qty:1, dir:'free', stack:'yes', maxStack:3 },
    { id:2, vendor:'A', l:50, w:50, h:50, wt:5, qty:1, dir:'free', stack:'no',  maxStack:1 },
  ];
  const r = packEP(items, c20);
  assert.equal(r.placed.length, 2);
  // no-stack box should be placed at origin (sorted first)
  const noStackBox = r.placed.find(b => b.origId === 2);
  assert.ok(noStackBox, 'no-stack box should be placed');
  assert.equal(noStackBox.px, 0, 'no-stack box placed first at x=0');
});

test('placed boxes have no overlaps', () => {
  const items = [
    { id:1, vendor:'A', l:80, w:80, h:80, wt:10, qty:10, dir:'free', stack:'yes', maxStack:5 },
  ];
  const r = packEP(items, c40);
  const p = r.placed;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const a = p[i], b = p[j];
      const overlapX = a.px < b.px + b.pl && b.px < a.px + a.pl;
      const overlapY = a.py < b.py + b.ph && b.py < a.py + a.ph;
      const overlapZ = a.pz < b.pz + b.pw && b.pz < a.pz + a.pw;
      assert.ok(!(overlapX && overlapY && overlapZ), `Box ${i} and ${j} overlap!`);
    }
  }
});

test('all placed boxes within container bounds', () => {
  const items = [
    { id:1, vendor:'A', l:60, w:40, h:35, wt:12, qty:20, dir:'up', stack:'yes', maxStack:3 },
  ];
  const r = packEP(items, c20);
  r.placed.forEach((b, i) => {
    assert.ok(b.px >= 0, `box ${i}: px < 0`);
    assert.ok(b.py >= 0, `box ${i}: py < 0`);
    assert.ok(b.pz >= 0, `box ${i}: pz < 0`);
    assert.ok(b.px + b.pl <= c20.l + 0.01, `box ${i}: exceeds L`);
    assert.ok(b.py + b.ph <= c20.h + 0.01, `box ${i}: exceeds H`);
    assert.ok(b.pz + b.pw <= c20.w + 0.01, `box ${i}: exceeds W`);
  });
});

test('volRate between 0 and 1', () => {
  const items = [{ id:1, vendor:'A', l:50, w:50, h:50, wt:5, qty:3, dir:'free', stack:'yes', maxStack:3 }];
  const r = packEP(items, c20);
  assert.ok(r.volRate >= 0 && r.volRate <= 1, `volRate=${r.volRate} out of range`);
});

test('empty items list → nothing placed', () => {
  const r = packEP([], c20);
  assert.equal(r.placed.length, 0);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.totalWt, 0);
});

test('vendor sorting: vendor A boxes placed before vendor B', () => {
  const items = [
    { id:1, vendor:'B', l:50, w:50, h:50, wt:5, qty:1, dir:'fixed', stack:'yes', maxStack:3 },
    { id:2, vendor:'A', l:50, w:50, h:50, wt:5, qty:1, dir:'fixed', stack:'yes', maxStack:3 },
  ];
  const r = packEP(items, c20);
  assert.equal(r.placed.length, 2);
  const aBox = r.placed.find(b => b.origId === 2);
  const bBox = r.placed.find(b => b.origId === 1);
  // A should be at lower x than B (placed first)
  assert.ok(aBox.px <= bBox.px, `Vendor A (x=${aBox.px}) should be placed before Vendor B (x=${bBox.px})`);
});

test('weight zone: no zone exceeds 60% of maxWt', () => {
  const items = [
    { id:1, vendor:'A', l:100, w:100, h:100, wt:1000, qty:20, dir:'free', stack:'yes', maxStack:5 },
  ];
  const r = packEP(items, c20);
  const maxZoneWt = c20.maxWt * 0.6;
  const zoneL = c20.l / 3;
  const zoneWt = [0, 0, 0];
  r.placed.forEach(b => {
    const zoneIdx = Math.min(2, Math.floor(b.px / zoneL));
    zoneWt[zoneIdx] += b.wt;
  });
  zoneWt.forEach((wt, i) => {
    assert.ok(wt <= maxZoneWt + 0.01, `Zone ${i} weight ${wt} exceeds 60% limit ${maxZoneWt}`);
  });
});

test('usedVol matches sum of placed box volumes', () => {
  const items = [{ id:1, vendor:'A', l:60, w:40, h:35, wt:5, qty:5, dir:'free', stack:'yes', maxStack:3 }];
  const r = packEP(items, c40);
  const calcVol = r.placed.reduce((s, b) => s + b.pl * b.ph * b.pw, 0);
  assert.ok(Math.abs(r.usedVol - calcVol) < 0.01, `usedVol mismatch: ${r.usedVol} vs ${calcVol}`);
});

// ══════════════════════════════════════════════
console.log('\n🧪  Container specs\n');

test('20ft container dimensions correct', () => {
  assert.equal(CONTS['20ft'].l, 589);
  assert.equal(CONTS['20ft'].w, 235);
  assert.equal(CONTS['20ft'].h, 239);
  assert.equal(CONTS['20ft'].maxWt, 28000);
});

test('40ft container dimensions correct', () => {
  assert.equal(CONTS['40ft'].l, 1200);
  assert.equal(CONTS['40ft'].w, 235);
  assert.equal(CONTS['40ft'].h, 239);
  assert.equal(CONTS['40ft'].maxWt, 26500);
});

test('40hc high cube dimensions correct', () => {
  assert.equal(CONTS['40hc'].l, 1200);
  assert.equal(CONTS['40hc'].w, 235);
  assert.equal(CONTS['40hc'].h, 269);
  assert.equal(CONTS['40hc'].maxWt, 26500);
});

test('high cube taller than standard 40ft', () => {
  assert.ok(CONTS['40hc'].h > CONTS['40ft'].h);
});

// ══════════════════════════════════════════════
console.log('\n🧪  Real-world data integration (be quiet! Excel)\n');

// Real Excel data: 5 SKUs, 2 vendors, 729 cartons, 40HC container
const realItems = [
  { id:101, vendor:'A', name:'PB600', l:51.7, w:28.8, h:56.8, wt:8.7,  qty:30,  stack:'yes', maxStack:4, dir:'free', color:'#f00' },
  { id:102, vendor:'A', name:'SB802', l:61.5, w:32.3, h:61.5, wt:13.34, qty:160, stack:'yes', maxStack:4, dir:'free', color:'#f00' },
  { id:103, vendor:'A', name:'DB901', l:63.3, w:34.5, h:68.4, wt:21.2,  qty:30,  stack:'yes', maxStack:3, dir:'free', color:'#f00' },
  { id:104, vendor:'A', name:'DB701', l:59.4, w:34.3, h:67.0, wt:15.35, qty:30,  stack:'yes', maxStack:4, dir:'free', color:'#f00' },
  { id:105, vendor:'B', name:'PB501', l:51.5, w:29.0, h:50.5, wt:9.1,   qty:479, stack:'yes', maxStack:5, dir:'free', color:'#00f' },
];
const c40hc = { l:1203, w:235, h:269, maxWt:26500 };
const realResult = packEP(realItems, c40hc);

test('real data: all 729 cartons placed (or ≥97%)', () => {
  const total = realResult.placed.length + realResult.unplaced.length;
  assert.equal(total, 729, 'total should be 729');
  const rate = realResult.placed.length / 729;
  assert.ok(rate >= 1.0, `placed rate ${(rate*100).toFixed(1)}% below 100% threshold`);
  console.log(`     → placed ${realResult.placed.length}/729 (${(rate*100).toFixed(1)}%)  vol=${( realResult.volRate*100).toFixed(1)}%`);
});

test('real data: vendor A boxes placed before vendor B (zone grouping)', () => {
  const aBoxes = realResult.placed.filter(b => String(b.vendor).toUpperCase() === 'A');
  const bBoxes = realResult.placed.filter(b => String(b.vendor).toUpperCase() === 'B');
  assert.ok(aBoxes.length > 0, 'should have A boxes placed');
  assert.ok(bBoxes.length > 0, 'should have B boxes placed');
  const aMaxX = Math.max(...aBoxes.map(b => b.px + b.pl));
  const bMinX = Math.min(...bBoxes.map(b => b.px));
  assert.ok(aMaxX <= bMinX + 100, `A max-x ${aMaxX.toFixed(0)} should be ≤ B min-x ${bMinX.toFixed(0)} (+100cm tolerance)`);
});

test('real data: no overlaps in placed boxes', () => {
  const p = realResult.placed;
  const eps = 0.01;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const a = p[i], b = p[j];
      if (a.px+a.pl > b.px+eps && b.px+b.pl > a.px+eps &&
          a.py+a.ph > b.py+eps && b.py+b.ph > a.py+eps &&
          a.pz+a.pw > b.pz+eps && b.pz+b.pw > a.pz+eps) {
        assert.fail(`Box ${i}(${a.name}) overlaps box ${j}(${b.name})`);
      }
    }
  }
});

test('real data: weight within limit', () => {
  assert.ok(realResult.totalWt <= c40hc.maxWt, `weight ${realResult.totalWt} exceeds limit ${c40hc.maxWt}`);
});

test('real data: door clearance reported correctly', () => {
  assert.ok(typeof realResult.doorClearance === 'number', 'doorClearance should be a number');
  assert.ok(realResult.doorClearance >= 0, 'doorClearance should be non-negative');
  console.log(`     → 實際門口預留: ${realResult.doorClearance.toFixed(1)} cm (建議 ≥ 10cm)`);
});

// ══════════════════════════════════════════════
console.log('\n─────────────────────────────────');
const total = passed + failed;
console.log(`\n  結果：${passed} passed / ${failed} failed / ${total} total\n`);
if (failed > 0) process.exit(1);
