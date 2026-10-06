// Geometry helpers shared across simulation systems.

// Distance between a unit's edge and another entity's edge (circle or rectangle).
export function edgeDist(u, t) {
  if (t.kind === 'unit') return Math.hypot(t.x - u.x, t.y - u.y) - u.r - t.r;
  const dx = Math.max(t.bx - u.x, 0, u.x - (t.bx + t.w));
  const dy = Math.max(t.by - u.y, 0, u.y - (t.by + t.h));
  return Math.hypot(dx, dy) - u.r;
}

// Distance from a point to an entity's edge.
export function pointEdgeDist(x, y, t) {
  if (t.kind === 'unit') return Math.hypot(t.x - x, t.y - y) - t.r;
  const dx = Math.max(t.bx - x, 0, x - (t.bx + t.w));
  const dy = Math.max(t.by - y, 0, y - (t.by + t.h));
  return Math.hypot(dx, dy);
}

// Closest point on an entity's footprint to (x,y)
export function closestPoint(t, x, y) {
  if (t.kind === 'unit') return [t.x, t.y];
  return [Math.min(Math.max(x, t.bx), t.bx + t.w), Math.min(Math.max(y, t.by), t.by + t.h)];
}

export function rectDist(ax, ay, aw, ah, bx, by, bw, bh) {
  const dx = Math.max(bx - (ax + aw), 0, ax - (bx + bw));
  const dy = Math.max(by - (ay + ah), 0, ay - (by + bh));
  return Math.hypot(dx, dy);
}

export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
