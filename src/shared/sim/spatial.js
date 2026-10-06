// Uniform-grid spatial hash for fast neighbour queries between units.
export class SpatialHash {
  constructor(width, height, cellSize = 4) {
    this.cs = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear() {
    for (const b of this.buckets) b.length = 0;
  }

  key(x, y) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cs)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cs)));
    return cy * this.cols + cx;
  }

  insert(e) {
    this.buckets[this.key(e.x, e.y)].push(e);
  }

  // Calls fn(entity) for each entity whose bucket overlaps the query circle.
  query(x, y, r, out = []) {
    out.length = 0;
    const cs = this.cs;
    const x0 = Math.max(0, Math.floor((x - r) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / cs));
    const y0 = Math.max(0, Math.floor((y - r) / cs));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / cs));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cy * this.cols + cx];
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}
