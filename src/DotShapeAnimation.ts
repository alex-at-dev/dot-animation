import { BaseAnimation } from './BaseAnimation';
import { Color } from './types/Color';
import { Point } from './types/Point';
import { getColorDiff } from './util/getColorDiff';

const WIDTH = 400;
const HEIGHT = 400;

const COL_TOP: Color = { r: 206, g: 254, b: 66, a: 1 }; // dot color for y=0
const COL_BOTTOM: Color = { r: 0, g: 194, b: 255, a: 1 }; // dot color for y=HEIGHT
const _COL_DELTA = getColorDiff(COL_TOP, COL_BOTTOM);

const DOT_R = 4; // dot radius
const DOT_GAP = 16; // gap between dots
const DOT_A = 0.08; // dot acceleration

// image elements by source. NOTE: this variable will be changed! (not reassigned, but filled with records)
const imageCache: Record<string, HTMLImageElement> = {};

export class DotShapeAnimation extends BaseAnimation {
  canvas: HTMLCanvasElement;
  cx: CanvasRenderingContext2D;
  canvasGradient: CanvasGradient;

  dots: Dot[] = [];
  points: Point[] = [];

  shapeCanvas: HTMLCanvasElement;
  shapeCx: CanvasRenderingContext2D;

  constructor(container: HTMLElement) {
    super(container);
    const { canvas, cx, canvasGradient, shapeCanvas, shapeCx } = this._initCanvas(container);
    this.canvas = canvas;
    this.cx = cx;
    this.canvasGradient = canvasGradient;

    // extra (hidden) canvas that we'll draw the desired shape on and take ImageData from to calc dot-positions
    this.shapeCanvas = shapeCanvas;
    this.shapeCx = shapeCx;
  }

  _initCanvas(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    container.appendChild(canvas);

    const cx = canvas.getContext('2d');
    if (!cx) throw new Error(`Cannot get rendering context from canvas.`);

    const canvasGradient = cx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    canvasGradient.addColorStop(0, `rgba(${COL_TOP.r},${COL_TOP.g},${COL_TOP.b},${COL_TOP.a})`);
    canvasGradient.addColorStop(
      1,
      `rgba(${COL_BOTTOM.r},${COL_BOTTOM.g},${COL_BOTTOM.b},${COL_BOTTOM.a})`
    );

    const shapeCanvas = document.createElement('canvas');
    shapeCanvas.width = WIDTH;
    shapeCanvas.height = HEIGHT;
    const shapeCx = shapeCanvas.getContext('2d');
    if (!shapeCx) throw new Error(`Cannot get rendering context from shape-canvas.`);

    return { canvas, cx, canvasGradient, shapeCanvas, shapeCx };
  }

  start() {
    this.dots = [];
    this.mainloop();
  }

  async setImage(url: string) {
    await this._drawImage(url);

    this._createPointsFromShapeCanvas();
    this._createDotsFromPoints();
  }

  /**
   * Pushes all dots to the outer screen bound
   */
  _explodeDots() {
    const center: Point = { x: WIDTH / 2, y: HEIGHT / 2 };
    const canvasHypot = Math.sqrt(((WIDTH / 2) * WIDTH) / 2 + ((HEIGHT / 2) * HEIGHT) / 2);
    for (let i = 0; i < this.dots.length; i++) {
      const dot = this.dots[i];
      const { dx, dy, d } = dot.distanceTo(center);
      const x = (dx / d) * canvasHypot + WIDTH / 2;
      const y = (dy / d) * canvasHypot + HEIGHT / 2;
      dot.target = { x, y };
    }
  }

  async _drawImage(src: string) {
    const img = await this.loadImage(src);

    const wRatio = this.shapeCanvas.width / img.width;
    const hRatio = this.shapeCanvas.height / img.height;
    const ratio = Math.min(wRatio, hRatio);
    const centerShiftX = (this.shapeCanvas.width - img.width * ratio) / 2;
    const centerShiftY = (this.shapeCanvas.height - img.height * ratio) / 2;
    this.shapeCx.clearRect(0, 0, WIDTH, HEIGHT);
    this.shapeCx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      centerShiftX,
      centerShiftY,
      img.width * ratio,
      img.height * ratio
    );
  }

  async loadImage(src: string): Promise<HTMLImageElement> {
    if (imageCache[src]) return Promise.resolve(imageCache[src]);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        imageCache[src] = img;
        resolve(img);
      };
      img.src = src;
    });
  }

  _createPointsFromShapeCanvas() {
    let x = 0;
    let y = 0;
    let w = 0;
    let h = 0;
    let xmin = WIDTH;
    let ymin = HEIGHT;
    this.points = [];
    const pixels = this.shapeCx.getImageData(0, 0, WIDTH, HEIGHT).data;

    // take only alpha pixels (data has rgba data for each pixel [r,g,b,a,r,g,b,a,...])
    let i = 3;
    while (i < pixels.length) {
      if (pixels[i]) {
        this.points.push({ x, y });

        if (x > w) w = x;
        if (y > h) h = y;
        if (x < xmin) xmin = x;
        if (y < ymin) ymin = y;
      }

      x += DOT_GAP;

      // jump to next row if we reached the end of this row
      if (x >= WIDTH) {
        x = 0;
        y += DOT_GAP;
        i = y * WIDTH * 4 + 3; // update i so it only takes every nth-row (n = DOT_GAP)
      }
      // otherwise just increase i
      else {
        i += 4 * DOT_GAP;
      }
    }
  }

  _createDotsFromPoints() {
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      let d = this.dots[i];
      if (!d) {
        d = new Dot(WIDTH / 2, HEIGHT / 2);
        this.dots.push(d);
      }
      d.isVisible = true;
      d.target = p;
    }
    if (this.dots.length <= this.points.length) return;

    const center: Point = { x: WIDTH / 2, y: HEIGHT / 2 };
    for (let i = this.points.length; i < this.dots.length; i++) {
      const dot = this.dots[i];
      dot.target = center;
      dot.isVisible = false;
    }
  }

  mainloop() {
    // using for-loop instead of foreach here as it's faster and this will be executed 30-60 times per second. (TODO maybe decreasing loop is faster (i = arr.length; i >= 0; i--))

    // -- update --
    let dotsDirty = false;
    for (let i = 0; i < this.dots.length; i++) {
      if (this.dots[i].update()) dotsDirty = true;
    }

    if (dotsDirty) {
      // -- render --
      // clear canvas
      this.cx.fillStyle = 'rgba(255,255,255,.9)';
      this.cx.fillRect(0, 0, WIDTH, HEIGHT);
      // this.cx.drawImage(this.shapeCanvas, 0, 0);
      // paint entities
      for (let i = 0; i < this.dots.length; i++) {
        this.dots[i].render(this.cx);
      }
    }

    // -- next frame --
    window.requestAnimationFrame(this.mainloop.bind(this));
  }
}

class Dot {
  static _id = 1;
  id: number;
  x: number;
  y: number;
  color: Color;
  target: Point | null = null;
  isVisible = true;

  constructor(x: number, y: number) {
    this.id = Dot._id++;
    this.x = x;
    this.y = y;
    this.color = { r: 0, g: 0, b: 0, a: 0 };
  }

  update() {
    if (!this.target) return false;

    // move towards target
    const { dx, dy, d } = this.distanceTo(this.target);
    const v = DOT_A * d;
    if (d > 1) {
      this.x += (dx / d) * v;
      this.y += (dy / d) * v;
    } else {
      this.target = null;
    }

    // update color
    const yRel = this.y / HEIGHT;

    this.color.r = COL_TOP.r + _COL_DELTA.r * yRel;
    this.color.g = COL_TOP.g + _COL_DELTA.g * yRel;
    this.color.b = COL_TOP.b + _COL_DELTA.b * yRel;

    if (this.isVisible && this.color.a !== 1) {
      if (this.color.a === 0) this.color.a = 0.01;
      this.color.a *= 1.5;
      if (this.color.a > 1) this.color.a = 1;
    } else if (!this.isVisible && this.color.a !== 0) {
      this.color.a *= 0.75;
      if (this.color.a < 0.01) this.color.a = 0;
    }

    return true;
  }

  render(cx: CanvasRenderingContext2D) {
    cx.fillStyle = `rgba(${this.color.r},${this.color.g},${this.color.b},${this.color.a})`;
    cx.beginPath();
    cx.arc(this.x, this.y, DOT_R, 0, 2 * Math.PI, false);
    cx.fill();
  }

  /**
   * Measures the distance from this dot to point {@link p}.
   * @param p point to measure distance to
   * @param pow if true returns the power of distance which saves a Math.sqrt call
   * @returns Distance to {@link p} in px.
   */
  distanceTo(p: Point) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return { dx, dy, d };
  }
}
