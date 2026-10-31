import {
  ActionCount,
  actionHubRadius,
  ActionName,
  Circle,
  circleDetail,
  Hub,
  HUB_HIT_PADDING,
  Layout,
  MAP_INSETS,
  Point,
  Repository,
  repositorySearch,
  SpatialIndex,
  STAR_TIERS,
  starTier,
  Viewport,
} from './model.js';

export type GraphHit =
  | { kind: 'repository'; repository: Repository }
  | { kind: 'action'; hub: Hub };

interface Callbacks {
  hover(
    hit: GraphHit | null,
    point: Point,
    radius?: number,
    avoid?: readonly Circle[]
  ): void;
  select(repository: Repository): void;
  action(action: ActionName): void;
  clear(): void;
  resize(): void;
}

interface Gesture {
  pointer: number;
  start: Point;
  translation: Point;
  offset: Point;
  hit: GraphHit | null;
  link: HTMLAnchorElement | null;
  moved: boolean;
}

interface Pinch {
  distance: number;
  scale: number;
  anchor: Point;
}

interface RepositoryLens {
  repository: Repository;
  center: Point;
  radius: number;
  maskRadius: number;
  circles: Map<string, PreviewCircle>;
}

interface LabelBox extends Point {
  width: number;
  height: number;
}

interface PreviewCircle extends Circle {
  opacity: number;
  emphasis: number;
}

interface PreviewFrame {
  circles: Map<string, PreviewCircle>;
  masks: Circle[];
  shade: number;
}

interface PreviewMotion {
  started: number | null;
  duration: number;
  from: PreviewFrame;
  to: PreviewFrame | null;
  shade: number;
  circles: Array<{
    from: PreviewCircle;
    to: PreviewCircle;
    current: PreviewCircle;
  }>;
  frame: PreviewFrame;
  following: boolean;
  previous: number | null;
}

const PREVIEW_DURATION = 240;
const NEXT_PULSE_DURATION = 700;
const NEXT_TARGET_DELAY = 180;
const NEXT_TARGET_MARGIN = 4;
const previewGap = (left: Circle, right: Circle, emphasis: number) =>
  0.002 + Math.min(1.5, (left.radius + right.radius) * 0.02) + 6 * emphasis;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const interpolate = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;
const fadeOpacity = (
  opacity: number,
  distanceSquared: number,
  clearance: number
) =>
  distanceSquared >= (clearance + opacity * 6) ** 2
    ? opacity
    : distanceSquared <= clearance ** 2
    ? 0
    : (Math.sqrt(distanceSquared) - clearance) / 6;
const tweenCircle = (
  from: PreviewCircle,
  to: PreviewCircle,
  progress: number,
  current: PreviewCircle = { ...from }
): PreviewCircle => {
  current.x = interpolate(from.x, to.x, progress);
  current.y = interpolate(from.y, to.y, progress);
  current.radius = interpolate(from.radius, to.radius, progress);
  current.opacity = interpolate(from.opacity, to.opacity, progress);
  current.emphasis = interpolate(from.emphasis, to.emphasis, progress);
  return current;
};
const fullStars = new Intl.NumberFormat('en');
const compactStars = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export class CanvasGraph {
  private readonly context: CanvasRenderingContext2D;
  private readonly highlight: CanvasRenderingContext2D;
  private readonly nameLayer = document.createElement('div');
  private readonly baseNames = new Map<string, LabelBox>();
  private readonly overlayNames = new Map<string, LabelBox>();
  private readonly nameLinks = new Map<
    string,
    { anchor: HTMLAnchorElement; bounds: LabelBox | null }
  >();
  private readonly suppressedLinks = new Set<HTMLAnchorElement>();
  private repositories: Repository[] = [];
  private byId = new Map<string, Repository>();
  private index = new SpatialIndex<Repository>([]);
  private layout: Layout = {
    hubs: [],
    center: { x: 0, y: 0 },
    width: 0,
    height: 0,
  };
  private counts: ActionCount[] = [];
  private selected: string | null = null;
  private hovered: GraphHit | null = null;
  private hoverPoint: Point | null = null;
  private proximityCandidate: { id: string; started: number } | null = null;
  private navigationCue: { id: string; started: number } | null = null;
  private selectedAnchor: Point | null = null;
  private lens: RepositoryLens | null = null;
  private displayed: PreviewFrame | null = null;
  private displayedIndex = new SpatialIndex<PreviewCircle>([]);
  private displayedLarge: PreviewCircle[] = [];
  private tooltipCircles: Circle[] = [];
  private obstacles: { circles: Circle[]; labels: LabelBox[] } | null = null;
  private previewMotion: PreviewMotion | null = null;
  private previewTarget: RepositoryLens | null = null;
  private previewAction: ActionName | null = null;
  private previewResume: { id: string; progress: number } | null = null;
  private readonly reducedMotion: MediaQueryList;
  private maxRadius = 0;
  private unit = 0;
  private maxTierSize = 1;
  private width = 0;
  private height = 0;
  private ratio = 1;
  private scale = 1;
  private translation: Point = { x: 0, y: 0 };
  private frame: number | null = null;
  private active = true;
  private sceneDirty = true;
  private readonly pointers = new Map<number, Point>();
  private gesture: Gesture | null = null;
  private pinch: Pinch | null = null;
  private pinching = false;

  public constructor(
    private readonly base: HTMLCanvasElement,
    private readonly overlay: HTMLCanvasElement,
    private readonly callbacks: Callbacks
  ) {
    const context = base.getContext('2d');
    const highlight = overlay.getContext('2d');
    if (!context || !highlight) {
      throw new Error('This browser does not support the canvas graph.');
    }
    const stage = overlay.parentElement;
    if (!stage || base.parentElement !== stage) {
      throw new Error('The graph canvases must share a stage.');
    }
    this.context = context;
    this.highlight = highlight;
    this.nameLayer.className = 'repository-name-links';
    this.nameLayer.setAttribute('role', 'group');
    this.nameLayer.setAttribute('aria-label', 'Repository action searches');
    stage.append(this.nameLayer);
    this.nameLayer.addEventListener('click', event => {
      const link = this.repositoryLink(event);
      if (link && event.detail > 0 && this.suppressedLinks.delete(link)) {
        event.preventDefault();
      }
    });
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', () => this.invalidate());
    new ResizeObserver(() => this.resize()).observe(stage);
    const surfaces: HTMLElement[] = [overlay, this.nameLayer];
    for (const surface of surfaces) {
      surface.addEventListener('pointerdown', event => this.pointerDown(event));
      surface.addEventListener('pointermove', event => this.pointerMove(event));
      surface.addEventListener('pointerup', event => this.pointerUp(event));
      surface.addEventListener('pointercancel', event =>
        this.pointerCancel(event)
      );
      surface.addEventListener('pointerleave', event => {
        const next = event.relatedTarget;
        if (
          !this.pointers.size &&
          !(
            next instanceof Node &&
            (next === overlay || this.nameLayer.contains(next))
          )
        ) {
          this.setHover(null, { x: 0, y: 0 });
        }
      });
      surface.addEventListener(
        'wheel',
        event => {
          event.preventDefault();
          const unit =
            event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
              ? this.height
              : 1;
          this.zoom(Math.exp(-event.deltaY * unit * 0.0015), this.point(event));
        },
        { passive: false }
      );
    }
    overlay.addEventListener('dblclick', event => {
      const hit = this.hit(this.point(event));
      if (hit && hit.kind === 'repository') {
        this.focus(hit.repository.id);
      } else {
        this.fit();
      }
    });
    overlay.addEventListener('keydown', event => {
      if (
        [
          '+',
          '=',
          '-',
          '0',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(event.key)
      ) {
        event.preventDefault();
        this.setHover(null, { x: 0, y: 0 });
        if (event.key === '+' || event.key === '=') this.zoomBy(1.3);
        if (event.key === '-') this.zoomBy(1 / 1.3);
        if (event.key === '0') this.fit();
        if (event.key === 'ArrowUp') this.translation.y += 60;
        if (event.key === 'ArrowDown') this.translation.y -= 60;
        if (event.key === 'ArrowLeft') this.translation.x += 60;
        if (event.key === 'ArrowRight') this.translation.x -= 60;
        this.invalidate(true);
      }
    });
  }

  public setData(
    repositories: Repository[],
    layout: Layout,
    counts: ActionCount[],
    fit: boolean
  ): void {
    const sameLayout =
      layout.width === this.layout.width &&
      layout.height === this.layout.height &&
      layout.center.x === this.layout.center.x &&
      layout.center.y === this.layout.center.y &&
      layout.hubs.length === this.layout.hubs.length &&
      layout.hubs.every(
        (hub, index) =>
          hub.action === this.layout.hubs[index].action &&
          hub.x === this.layout.hubs[index].x &&
          hub.y === this.layout.hubs[index].y
      );
    const sameRepositories =
      !fit &&
      repositories.length === this.repositories.length &&
      repositories.every(repository => this.byId.has(repository.id));
    this.repositories = repositories;
    this.byId = new Map(
      repositories.map(repository => [repository.id, repository])
    );
    this.maxRadius = repositories.reduce(
      (maximum, repository) => Math.max(maximum, repository.radius),
      0
    );
    this.maxTierSize = repositories.reduce(
      (maximum, repository) =>
        Math.max(maximum, starTier(repository.stars).size),
      1
    );
    this.unit = repositories.length
      ? repositories[0].radius / starTier(repositories[0].stars).size
      : 0;
    this.index = new SpatialIndex(
      repositories,
      Math.max(16, this.maxRadius * 2)
    );
    this.layout = layout;
    this.counts = counts;
    if (sameLayout && sameRepositories) {
      this.invalidate();
      return;
    }
    this.hovered = null;
    this.hoverPoint = null;
    this.proximityCandidate = null;
    this.navigationCue = null;
    this.selectedAnchor = null;
    this.lens = null;
    if (fit) {
      this.fit();
    } else {
      this.invalidate(true);
    }
  }

  public setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.nameLayer.hidden = !active;
    if (!active && this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.preview(null);
    if (active) this.resize();
  }

  public select(id: string | null): void {
    this.proximityCandidate = null;
    this.navigationCue = null;
    if (this.selected !== id) {
      const circle = id ? this.displayed?.circles.get(id) : null;
      this.selectedAnchor = circle ? this.world(circle) : null;
      this.selected = id;
      this.lens = null;
    }
    this.invalidate();
  }

  public preview(id: string | null): void {
    const repository = id ? this.byId.get(id) : null;
    this.hovered = repository ? { kind: 'repository', repository } : null;
    this.hoverPoint = null;
    this.proximityCandidate = null;
    this.navigationCue = null;
    this.invalidate();
  }

  public focus(id: string): void {
    const repository = this.byId.get(id);
    if (!repository) return;
    this.selectedAnchor = null;
    this.scale = Math.max(
      this.scale,
      Math.min(
        1.4,
        (Math.min(this.width, this.height) - 80) / (repository.radius * 2)
      )
    );
    this.translation = {
      x: this.width / 2 - repository.x * this.scale,
      y: this.height / 2 - repository.y * this.scale,
    };
    this.invalidate(true);
  }

  public fit(): void {
    if (
      !this.width ||
      !this.height ||
      !this.layout.width ||
      !this.layout.height
    )
      return;
    let minX = 0,
      minY = 0,
      maxX = this.layout.width,
      maxY = this.layout.height;
    for (const repository of this.repositories) {
      minX = Math.min(minX, repository.x - repository.radius - 8);
      minY = Math.min(minY, repository.y - repository.radius - 8);
      maxX = Math.max(maxX, repository.x + repository.radius + 8);
      maxY = Math.max(maxY, repository.y + repository.radius + 8);
    }
    this.scale = clamp(
      Math.min(this.width / (maxX - minX), this.height / (maxY - minY)),
      0.025,
      8
    );
    this.translation = {
      x: this.width / 2 - ((minX + maxX) / 2) * this.scale,
      y: this.height / 2 - ((minY + maxY) / 2) * this.scale,
    };
    this.invalidate(true);
  }

  public zoomBy(factor: number): void {
    this.zoom(factor, { x: this.width / 2, y: this.height / 2 });
  }

  public viewport(): Viewport {
    return {
      width: this.width || this.overlay.clientWidth,
      height: this.height || this.overlay.clientHeight,
    };
  }

  private resize(): void {
    if (!this.active) return;
    const bounds = this.base.parentElement!.getBoundingClientRect();
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (
      !width ||
      !height ||
      (width === this.width && height === this.height && ratio === this.ratio)
    )
      return;
    const initial = !this.width;
    const changedSize = width !== this.width || height !== this.height;
    this.translation.x += (width - this.width) / 2;
    this.translation.y += (height - this.height) / 2;
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    for (const canvas of [this.base, this.overlay]) {
      canvas.width = width * this.ratio;
      canvas.height = height * this.ratio;
    }
    if (initial) this.fit();
    this.invalidate(true);
    if (changedSize) this.callbacks.resize();
  }

  private point(event: MouseEvent | PointerEvent): Point {
    const bounds = this.overlay.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private world(point: Point): Point {
    return {
      x: (point.x - this.translation.x) / this.scale,
      y: (point.y - this.translation.y) / this.scale,
    };
  }

  private screen(point: Point): Point {
    return {
      x: point.x * this.scale + this.translation.x,
      y: point.y * this.scale + this.translation.y,
    };
  }

  private hit(point: Point): GraphHit | null {
    for (const hub of this.layout.hubs) {
      const position = this.hubPosition(hub);
      if (
        Math.hypot(position.x - point.x, position.y - point.y) <
        this.hubRadius() + HUB_HIT_PADDING
      ) {
        return { kind: 'action', hub };
      }
    }
    const displayed = this.displayed;
    let foreground: PreviewCircle | null = null;
    for (const circle of this.displayedLarge) {
      if (
        circle.emphasis > 0 &&
        Math.hypot(circle.x - point.x, circle.y - point.y) <=
          circle.radius + 2 &&
        (!foreground || circle.emphasis >= foreground.emphasis)
      ) {
        foreground = circle;
      }
    }
    if (foreground) {
      return { kind: 'repository', repository: this.byId.get(foreground.id)! };
    }
    let nearby: PreviewCircle | null = null;
    for (const circle of this.displayedLarge) {
      if (
        !circle.emphasis &&
        Math.hypot(circle.x - point.x, circle.y - point.y) <=
          circle.radius + 2 &&
        (!nearby ||
          Math.hypot(circle.x - point.x, circle.y - point.y) <
            Math.hypot(nearby.x - point.x, nearby.y - point.y))
      ) {
        nearby = circle;
      }
    }
    const neighbor = nearby || this.displayedIndex.find(point, 2);
    if (neighbor) {
      return { kind: 'repository', repository: this.byId.get(neighbor.id)! };
    }
    if (
      displayed?.masks.some(
        mask => Math.hypot(mask.x - point.x, mask.y - point.y) <= mask.radius
      )
    ) {
      return null;
    }
    const repository = this.index.find(this.world(point), 5 / this.scale);
    return repository ? { kind: 'repository', repository } : null;
  }

  private nextRepository(time: number): PreviewCircle | null {
    const frame = this.displayed;
    const point = this.hoverPoint;
    if (
      !this.selected ||
      this.hovered?.kind === 'action' ||
      !point ||
      !frame?.circles.has(this.selected) ||
      this.pointers.size ||
      this.pinching
    ) {
      this.proximityCandidate = null;
      this.navigationCue = null;
      return null;
    }
    let nearest: PreviewCircle | null = null;
    let nearestDistance = Infinity;
    let current: PreviewCircle | null = null;
    let currentDistance = Infinity;
    for (const circle of frame.circles.values()) {
      if (
        circle.id === this.selected ||
        circle.opacity <= 0.001 ||
        !this.inView(circle, circle.radius)
      )
        continue;
      const distance = Math.max(
        0,
        Math.hypot(circle.x - point.x, circle.y - point.y) - circle.radius
      );
      if (circle.id === this.navigationCue?.id) {
        current = circle;
        currentDistance = distance;
      }
      if (
        distance < nearestDistance ||
        (distance === nearestDistance && nearest && circle.id < nearest.id)
      ) {
        nearestDistance = distance;
        nearest = circle;
      }
    }
    if (current && currentDistance <= nearestDistance + NEXT_TARGET_MARGIN) {
      this.proximityCandidate = null;
      return current;
    }
    if (!nearest) {
      this.proximityCandidate = null;
      this.navigationCue = null;
      return null;
    }
    if (!current) this.navigationCue = null;
    if (this.proximityCandidate?.id !== nearest.id)
      this.proximityCandidate = { id: nearest.id, started: time };
    // Keep the accepted cue until a meaningfully closer target persists.
    if (time - this.proximityCandidate.started < NEXT_TARGET_DELAY)
      return current;
    this.proximityCandidate = null;
    this.navigationCue = { id: nearest.id, started: time };
    return nearest;
  }

  private setHover(hit: GraphHit | null, point: Point, mouse = false): void {
    const identity = (value: GraphHit | null) =>
      value
        ? value.kind === 'repository'
          ? value.repository.id
          : value.hub.action
        : '';
    const changed = identity(hit) !== identity(this.hovered);
    const hoverPoint = mouse && hit?.kind !== 'action' ? point : null;
    const moved =
      hoverPoint?.x !== this.hoverPoint?.x ||
      hoverPoint?.y !== this.hoverPoint?.y;
    this.hoverPoint = hoverPoint;
    if (!hoverPoint) {
      this.proximityCandidate = null;
      this.navigationCue = null;
    }
    this.hovered = hit;
    this.overlay.style.cursor = hit ? 'pointer' : 'grab';
    const circle =
      hit?.kind === 'repository'
        ? this.displayed?.circles.get(hit.repository.id) ||
          this.nativeCircle(hit.repository.id, null)
        : null;
    this.callbacks.hover(
      hit,
      circle || point,
      circle?.radius,
      this.tooltipObstacles()
    );
    if (changed || (moved && this.selected)) this.invalidate();
  }

  private repositoryLink(event: Event): HTMLAnchorElement | null {
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('.repository-name-link')
        : null;
    return link && this.nameLayer.contains(link) ? link : null;
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const point = this.point(event);
    const link = this.repositoryLink(event);
    if (!this.pointers.size) this.suppressedLinks.clear();
    this.pointers.set(event.pointerId, point);
    this.hoverPoint = null;
    this.proximityCandidate = null;
    this.navigationCue = null;
    this.invalidate();
    (link || this.overlay).setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) {
      this.pinching = false;
      const hit = this.hit(point);
      const world = this.world(point);
      const position =
        hit?.kind === 'repository'
          ? this.world(
              this.displayed?.circles.get(hit.repository.id) ||
                this.displayPosition(hit.repository)
            )
          : world;
      this.gesture = {
        pointer: event.pointerId,
        start: point,
        translation: { ...this.translation },
        hit,
        link,
        offset:
          hit && hit.kind === 'repository'
            ? { x: world.x - position.x, y: world.y - position.y }
            : { x: 0, y: 0 },
        moved: false,
      };
    } else if (this.pointers.size === 2) {
      if (this.gesture?.link) this.suppressedLinks.add(this.gesture.link);
      if (link) this.suppressedLinks.add(link);
      for (const pointer of this.pointers.keys())
        this.overlay.setPointerCapture(pointer);
      const [left, right] = Array.from(this.pointers.values());
      const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      this.pinch = {
        distance: Math.max(1, Math.hypot(left.x - right.x, left.y - right.y)),
        scale: this.scale,
        anchor: this.world(midpoint),
      };
      this.pinching = true;
      this.gesture = null;
    }
    this.overlay.style.cursor = 'grabbing';
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.point(event);
    if (!this.pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse')
        this.setHover(this.hit(point), point, true);
      return;
    }
    this.pointers.set(event.pointerId, point);
    if (this.pinch && this.pointers.size >= 2) {
      const [left, right] = Array.from(this.pointers.values());
      this.scale = clamp(
        (this.pinch.scale * Math.hypot(left.x - right.x, left.y - right.y)) /
          this.pinch.distance,
        0.025,
        8
      );
      this.translation = {
        x: (left.x + right.x) / 2 - this.pinch.anchor.x * this.scale,
        y: (left.y + right.y) / 2 - this.pinch.anchor.y * this.scale,
      };
      this.invalidate(true);
      return;
    }
    const gesture = this.gesture;
    if (!gesture || this.pinching || gesture.pointer !== event.pointerId)
      return;
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (Math.hypot(dx, dy) > 4) {
      gesture.moved = true;
      if (gesture.link && !this.overlay.hasPointerCapture(event.pointerId)) {
        this.suppressedLinks.add(gesture.link);
        this.overlay.setPointerCapture(event.pointerId);
      }
    }
    if (!gesture.moved) return;
    if (gesture.hit && gesture.hit.kind === 'repository') {
      this.selectedAnchor = null;
      const world = this.world(point);
      this.index.move(gesture.hit.repository, {
        x: world.x - gesture.offset.x,
        y: world.y - gesture.offset.y,
      });
    } else {
      this.setHover(null, point);
      this.translation = {
        x: gesture.translation.x + dx,
        y: gesture.translation.y + dy,
      };
    }
    this.callbacks.hover(null, point);
    this.invalidate(true);
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    const link = this.repositoryLink(event);
    this.pointers.delete(event.pointerId);
    if (link?.hasPointerCapture(event.pointerId)) {
      link.releasePointerCapture(event.pointerId);
    }
    if (this.overlay.hasPointerCapture(event.pointerId)) {
      this.overlay.releasePointerCapture(event.pointerId);
    }
    if (event.pointerType !== 'mouse') {
      this.setHover(null, this.point(event));
    } else if (gesture && !gesture.moved && !this.pinching) {
      const point = this.point(event);
      this.setHover(this.hit(point), point, true);
    }
    if (
      !this.pinching &&
      gesture &&
      gesture.pointer === event.pointerId &&
      !gesture.moved &&
      !gesture.link
    ) {
      if (gesture.hit && gesture.hit.kind === 'repository') {
        this.callbacks.select(gesture.hit.repository);
      } else if (gesture.hit && gesture.hit.kind === 'action') {
        this.callbacks.action(gesture.hit.hub.action);
      } else {
        this.callbacks.clear();
      }
    }
    if (this.pointers.size < 2) this.pinch = null;
    if (!this.pointers.size) {
      this.pinching = false;
      this.gesture = null;
      this.overlay.style.cursor = 'grab';
      if (gesture?.link) this.invalidate();
    }
  }

  private pointerCancel(event: PointerEvent): void {
    const link = this.repositoryLink(event);
    if (link) this.suppressedLinks.add(link);
    this.pointers.delete(event.pointerId);
    this.pinch = null;
    this.gesture = null;
    if (!this.pointers.size) this.pinching = false;
    this.setHover(null, this.point(event));
    this.invalidate();
  }

  private zoom(factor: number, anchor: Point): void {
    const world = this.world(anchor);
    this.scale = clamp(this.scale * factor, 0.025, 8);
    this.translation = {
      x: anchor.x - world.x * this.scale,
      y: anchor.y - world.y * this.scale,
    };
    this.setHover(null, anchor);
    this.invalidate(true);
  }

  private invalidate(scene = false): void {
    if (scene) {
      const id = this.selected;
      const progress =
        this.previewResume?.id === id
          ? this.previewResume?.progress || 0
          : id
          ? this.displayed?.circles.get(id)?.emphasis || 0
          : 0;
      // Camera/data redraws keep the current enlargement instead of restarting it.
      this.previewResume = id && this.byId.has(id) ? { id, progress } : null;
      this.lens = null;
      this.hoverPoint = null;
      this.proximityCandidate = null;
      this.navigationCue = null;
      this.previewMotion = null;
      this.previewTarget = null;
      this.displayed = null;
      this.displayedIndex = new SpatialIndex<PreviewCircle>([]);
      this.displayedLarge = [];
      this.tooltipCircles = [];
      this.obstacles = null;
    }
    this.sceneDirty = this.sceneDirty || scene;
    if (!this.active || this.frame !== null) return;
    // Hover repaints the overlay, never the base scene.
    this.frame = requestAnimationFrame(time => {
      this.frame = null;
      if (this.sceneDirty) {
        this.drawScene();
        this.sceneDirty = false;
      }
      const animating = this.animatePreview(time);
      const pulsing = this.drawHighlight(time);
      this.syncNameLinks();
      if (this.previewMotion && this.previewMotion.started === null) {
        // Target preparation must not consume the visible transition.
        this.previewMotion.started = performance.now();
      }
      if (
        this.hovered?.kind === 'repository' &&
        this.hoverPoint &&
        !this.pointers.size
      ) {
        const circle =
          this.displayed?.circles.get(this.hovered.repository.id) ||
          this.nativeCircle(this.hovered.repository.id, null);
        this.callbacks.hover(
          this.hovered,
          circle,
          circle.radius,
          this.tooltipObstacles()
        );
      }
      if (animating || pulsing) this.invalidate();
    });
  }

  private nativeCircle(id: string, action: ActionName | null): PreviewCircle {
    const repository = this.byId.get(id)!;
    return {
      ...this.screen(repository),
      id,
      radius: repository.radius * this.scale,
      opacity: !action || repository.actions.includes(action) ? 1 : 0.4,
      emphasis: 0,
    };
  }

  private createPreview(lens: RepositoryLens | null): PreviewFrame | null {
    if (!lens) return null;
    return {
      circles: new Map(lens.circles),
      masks: [
        { ...lens.center, id: lens.repository.id, radius: lens.maskRadius },
      ],
      shade: 1,
    };
  }

  private displayPreview(frame: PreviewFrame | null): void {
    this.displayed = frame;
    this.displayedLarge = [];
    this.tooltipCircles = [];
    const circles: PreviewCircle[] = [];
    for (const circle of frame?.circles.values() || []) {
      if (circle.opacity <= 0.001 || !this.inView(circle, circle.radius))
        continue;
      if (circle.emphasis || circle.radius >= 26)
        this.tooltipCircles.push(circle);
      if (circle.emphasis || circle.radius > this.maxRadius * this.scale) {
        this.displayedLarge.push(circle);
      } else {
        circles.push(circle);
      }
    }
    this.displayedIndex = new SpatialIndex(
      circles,
      Math.max(16, this.maxRadius * this.scale * 2)
    );
  }

  private animatePreview(time: number): boolean {
    const target = this.selectionLens();
    const action =
      !target && this.hovered?.kind === 'action'
        ? this.hovered.hub.action
        : null;
    const previous = this.previewTarget;
    const resume =
      this.previewResume?.id === target?.repository.id
        ? this.previewResume?.progress || 0
        : 0;
    this.previewResume = null;
    const unchanged = target === previous;
    if (
      this.reducedMotion.matches ||
      this.gesture?.moved ||
      this.pinching ||
      resume === 1
    ) {
      this.previewTarget = target;
      this.previewAction = action;
      this.previewMotion = null;
      this.displayPreview(this.createPreview(target));
      return false;
    }
    if (!unchanged || action !== this.previewAction) {
      const to = this.createPreview(target);
      const shade = to?.shade || (action ? 1 : 0);
      const following = Boolean(
        target &&
          previous &&
          target.repository.id === previous.repository.id &&
          action === this.previewAction
      );
      const motion = this.previewMotion;
      if (
        following &&
        motion?.following &&
        to &&
        motion.circles.length === to.circles.size &&
        motion.circles.every(circle => to.circles.has(circle.current.id))
      ) {
        for (const circle of motion.circles)
          circle.to = to.circles.get(circle.current.id)!;
        motion.to = to;
        motion.shade = shade;
        motion.started = null;
      } else {
        const from = this.displayed || {
          circles: new Map<string, PreviewCircle>(),
          masks: [],
          shade: this.previewAction ? 1 : 0,
        };
        const ids = new Set([
          ...(to?.circles.keys() || []),
          ...from.circles.keys(),
        ]);
        const masks = [...from.masks, ...(to?.masks || [])];
        const shadeFrom = interpolate(from.shade, shade, resume);
        const circles = Array.from(ids, id => {
          const start =
            from.circles.get(id) || this.nativeCircle(id, this.previewAction);
          const end = to?.circles.get(id) || this.nativeCircle(id, action);
          const origin = resume ? tweenCircle(start, end, resume) : start;
          // Mutable frame geometry must not alias interpolation endpoints.
          return {
            from: origin,
            to: end,
            current: { ...origin },
          };
        });
        this.previewMotion = ids.size
          ? {
              started: null,
              duration: PREVIEW_DURATION * (1 - resume),
              from: {
                ...from,
                shade: shadeFrom,
              },
              to,
              shade,
              circles,
              frame: {
                circles: new Map(
                  circles.map(circle => [circle.current.id, circle.current])
                ),
                masks: Array.from(
                  new Map(
                    masks.map(mask => [
                      `${mask.x},${mask.y},${mask.radius}`,
                      mask,
                    ])
                  ).values()
                ),
                shade: shadeFrom,
              },
              following,
              previous: null,
            }
          : null;
      }
      this.previewTarget = target;
      this.previewAction = action;
      if (!this.previewMotion) this.displayPreview(to);
    }
    const motion = this.previewMotion;
    if (!motion) return false;
    const elapsed =
      motion.started === null
        ? 0
        : clamp((time - motion.started) / motion.duration, 0, 1);
    if (elapsed === 1) {
      this.previewMotion = null;
      this.displayPreview(motion.to);
      return false;
    }
    // Pointer retargeting must advance every frame, not restart a slow ease-in.
    const delta =
      motion.previous === null ? 16 : clamp(time - motion.previous, 0, 64);
    const progress = motion.following
      ? 1 - Math.exp(-delta / 45)
      : elapsed * elapsed * (3 - 2 * elapsed);
    motion.previous = time;
    for (const { from, to, current } of motion.circles) {
      tweenCircle(motion.following ? current : from, to, progress, current);
    }
    this.packPreview(motion.frame.circles, false);
    motion.frame.shade = interpolate(
      motion.following ? motion.frame.shade : motion.from.shade,
      motion.shade,
      progress
    );
    this.displayPreview(motion.frame);
    return true;
  }

  private prepare(context: CanvasRenderingContext2D): void {
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
  }

  private color(repository: Repository): string {
    return starTier(repository.stars).color;
  }

  private inView(point: Point, margin = 30): boolean {
    return (
      point.x >= -margin &&
      point.x <= this.width + margin &&
      point.y >= -margin &&
      point.y <= this.height + margin
    );
  }

  private drawRepository(
    context: CanvasRenderingContext2D,
    repository: Repository,
    point = this.screen(repository),
    radius = repository.radius * this.scale,
    bright = false
  ): void {
    const detail = circleDetail(radius);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = this.color(repository);
    context.fill();
    if (bright) {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255, 255, 255, 0.28)';
      context.fill();
    }
    if (detail === 'none') return;
    context.strokeStyle = starTier(repository.stars).textColor;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, radius - 1, 0, Math.PI * 2);
    context.stroke();
    this.drawContents(context, repository, point, radius);
  }

  private displayPosition(repository: Repository): Point {
    if (this.selected === repository.id && this.selectedAnchor)
      return this.screen(this.selectedAnchor);
    return (
      this.displayed?.circles.get(repository.id) || this.screen(repository)
    );
  }

  private selectionLens(): RepositoryLens | null {
    const repository = this.selected ? this.byId.get(this.selected) : null;
    if (!repository) return null;
    if (this.lens?.repository.id === repository.id) return this.lens;
    const origin = this.displayPosition(repository);
    const mobileSelection =
      this.selected === repository.id &&
      window.matchMedia('(max-width: 760px)').matches;
    const top = mobileSelection ? 28 : MAP_INSETS.top;
    const bottom = mobileSelection ? 0 : MAP_INSETS.bottom;
    const hubs = this.layout.hubs.map(hub => this.hubPosition(hub));
    const hubRadius = this.hubRadius();
    this.highlight.save();
    this.highlight.font = '600 13px system-ui, sans-serif';
    const labels = this.layout.hubs.map(hub => ({
      ...this.hubLabelPosition(hub),
      width: this.highlight.measureText(hub.action).width,
    }));
    this.highlight.restore();
    const labelDistance = (point: Point, label: typeof labels[number]) =>
      Math.hypot(
        Math.max(Math.abs(point.x - label.x) - label.width / 2, 0),
        Math.max(Math.abs(point.y - label.y) - 7, 0)
      );
    const fallback = {
      x: this.width / 2,
      y: (top + hubs[1].y - hubRadius) / 2,
    };
    // One shared popup limit avoids action hubs without flattening tier ratios.
    const available = Math.min(
      fallback.x - MAP_INSETS.left - 8,
      this.width - MAP_INSETS.right - fallback.x - 8,
      fallback.y - top - 8,
      this.height - bottom - fallback.y - 8,
      ...hubs.map(
        hub =>
          Math.hypot(fallback.x - hub.x, fallback.y - hub.y) - hubRadius - 16
      ),
      ...labels.map(label => labelDistance(fallback, label) - 8)
    );
    const radius =
      starTier(repository.stars).size *
      Math.min(
        available / this.maxTierSize,
        Math.max(48, this.unit * this.scale * 1.2)
      );
    let center = origin;
    if (this.inView(origin, repository.radius * this.scale)) {
      const preferred = {
        x: clamp(
          origin.x,
          MAP_INSETS.left + radius + 8,
          this.width - MAP_INSETS.right - radius - 8
        ),
        y: clamp(origin.y, top + radius + 8, this.height - bottom - radius - 8),
      };
      center = fallback;
      const candidates = [
        preferred,
        { x: fallback.x, y: preferred.y },
        {
          x: preferred.x,
          y: clamp(
            hubs[0].y + hubRadius + radius + 8,
            top + radius + 8,
            this.height - bottom - radius - 8
          ),
        },
      ];
      for (const point of candidates) {
        if (
          hubs.every(
            hub =>
              Math.hypot(point.x - hub.x, point.y - hub.y) >=
              radius + hubRadius + 16
          ) &&
          labels.every(label => labelDistance(point, label) >= radius + 8) &&
          Math.hypot(point.x - origin.x, point.y - origin.y) <
            Math.hypot(center.x - origin.x, center.y - origin.y)
        ) {
          center = point;
        }
      }
    }
    const nativeUnit = this.unit * this.scale;
    const nearbyUnit = Math.max(
      nativeUnit,
      Math.min(30, (radius / starTier(repository.stars).size) * 0.625)
    );
    const nearby = this.nearestRepositories(
      origin,
      radius * 2.5 + 80,
      this.nearbyLimit(),
      repository.id
    );
    const circle = this.nativeCircle(repository.id, null);
    const primary: PreviewCircle = {
      ...circle,
      ...center,
      radius,
      opacity: 1,
      emphasis: 1,
    };
    const circles = new Map<string, PreviewCircle>([[repository.id, primary]]);
    for (const { repository: neighbor } of nearby) {
      circles.set(neighbor.id, {
        ...this.nativeCircle(neighbor.id, null),
        radius: nearbyUnit * starTier(neighbor.stars).size,
        opacity: 0.95,
      });
    }
    for (const item of this.index.within(
      this.world({ x: this.width / 2, y: this.height / 2 }),
      Math.hypot(this.width, this.height) / (2 * this.scale)
    )) {
      if (circles.has(item.id)) continue;
      const circle = this.nativeCircle(item.id, null);
      circle.opacity = 0.65;
      circles.set(item.id, circle);
    }
    this.packPreview(circles);
    this.lens = {
      repository,
      center,
      radius,
      maskRadius: Math.hypot(this.width, this.height),
      circles,
    };
    return this.lens;
  }

  private nearbyLimit(): number {
    return window.matchMedia('(hover: none)').matches
      ? 0
      : this.width >= 600
      ? 6
      : this.width >= 420
      ? 4
      : 2;
  }

  private nearestRepositories(
    origin: Point,
    radius: number,
    limit: number,
    exclude: string
  ): Array<{ repository: Repository; distance: number }> {
    const nearest: Array<{ repository: Repository; distance: number }> = [];
    if (!limit) return nearest;
    const point = this.world(origin);
    for (const repository of this.index.within(point, radius / this.scale)) {
      if (repository.id === exclude) continue;
      const distance =
        ((repository.x - point.x) ** 2 + (repository.y - point.y) ** 2) *
        this.scale ** 2;
      let position = 0;
      while (
        position < nearest.length &&
        nearest[position].distance <= distance
      )
        position++;
      if (position >= limit) continue;
      nearest.splice(position, 0, { repository, distance });
      if (nearest.length > limit) nearest.pop();
    }
    return nearest;
  }

  private previewObstacles() {
    if (this.obstacles) return this.obstacles;
    this.highlight.save();
    this.highlight.font = '600 13px system-ui, sans-serif';
    this.obstacles = {
      circles: this.layout.hubs.map(hub => ({
        ...this.hubPosition(hub),
        id: hub.action,
        radius: this.hubRadius() + HUB_HIT_PADDING,
      })),
      labels: this.layout.hubs.map(hub => ({
        ...this.hubLabelPosition(hub),
        width: this.highlight.measureText(hub.action).width + 6,
        height: 20,
      })),
    };
    this.highlight.restore();
    return this.obstacles;
  }

  private tooltipObstacles(): Circle[] {
    const obstacles = this.previewObstacles();
    return [
      ...this.tooltipCircles,
      ...obstacles.circles,
      ...obstacles.labels.map((label, index) => ({
        ...label,
        id: `label-${index}`,
        radius: Math.hypot(label.width, label.height) / 2,
      })),
    ];
  }

  private packPreview(
    circles: Map<string, PreviewCircle>,
    strict = true
  ): Map<string, PreviewCircle> {
    const obstacles = this.previewObstacles();
    const mobileSelection =
      this.selected && window.matchMedia('(max-width: 760px)').matches;
    const top = mobileSelection ? 28 : MAP_INSETS.top;
    const bottom = mobileSelection ? 0 : MAP_INSETS.bottom;
    const large: Circle[] = [...obstacles.circles];
    const packed = new Map<string, PreviewCircle>();
    const unexpanded = new Set<string>();
    const primary = this.selected;
    const order = Array.from(circles.values()).filter(
      circle =>
        circle.emphasis ||
        (circle.opacity > 0.001 &&
          circle.radius > this.byId.get(circle.id)!.radius * this.scale + 1e-9)
    );
    const first = order.findIndex(circle => circle.id === primary);
    if (first > 0) order.unshift(...order.splice(first, 1));
    for (const circle of order) {
      const bounds = {
        left: strict
          ? circle.radius + 4
          : Math.min(circle.radius + 4, circle.x),
        right: strict
          ? this.width - circle.radius - 4
          : Math.max(this.width - circle.radius - 4, circle.x),
        top: strict
          ? top + circle.radius
          : Math.min(top + circle.radius, circle.y),
        bottom: strict
          ? this.height - bottom - circle.radius
          : Math.max(this.height - bottom - circle.radius, circle.y),
      };
      const preferred = {
        x: clamp(circle.x, bounds.left, bounds.right),
        y: clamp(circle.y, bounds.top, bounds.bottom),
      };
      const expanded = large.map(other => ({
        ...other,
        radius:
          circle.radius +
          other.radius +
          previewGap(
            circle,
            other,
            Math.max(circle.emphasis, packed.get(other.id)?.emphasis || 0)
          ),
      }));
      const valid = (point: Point) =>
        point.x >= bounds.left - 0.0001 &&
        point.x <= bounds.right + 0.0001 &&
        point.y >= bounds.top - 0.0001 &&
        point.y <= bounds.bottom + 0.0001 &&
        expanded.every(
          other =>
            Math.hypot(point.x - other.x, point.y - other.y) >=
            other.radius - 0.0001
        ) &&
        obstacles.labels.every(
          label =>
            Math.hypot(
              Math.max(Math.abs(point.x - label.x) - label.width / 2, 0),
              Math.max(Math.abs(point.y - label.y) - label.height / 2, 0)
            ) >=
            circle.radius + 1
        );
      let position: Point | null = null;
      let distance = Infinity;
      const consider = (point: Point) => {
        const score =
          (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2;
        if (score < distance && valid(point)) {
          position = point;
          distance = score;
        }
      };
      consider(preferred);
      const parent = expanded.find(other => other.id === primary);
      if (!position && parent) {
        const length = Math.hypot(
          preferred.x - parent.x,
          preferred.y - parent.y
        );
        if (length && length < parent.radius) {
          consider({
            x: parent.x + ((preferred.x - parent.x) / length) * parent.radius,
            y: parent.y + ((preferred.y - parent.y) / length) * parent.radius,
          });
        }
      }
      if (!position) {
        const xs = [bounds.left, bounds.right];
        const ys = [bounds.top, bounds.bottom];
        const contacts = [...expanded];
        for (const label of obstacles.labels) {
          const x = [label.x - label.width / 2, label.x + label.width / 2];
          const y = [label.y - label.height / 2, label.y + label.height / 2];
          xs.push(x[0] - circle.radius - 1.002, x[1] + circle.radius + 1.002);
          ys.push(y[0] - circle.radius - 1.002, y[1] + circle.radius + 1.002);
          for (const left of x) {
            for (const top of y)
              contacts.push({
                id: '',
                x: left,
                y: top,
                radius: circle.radius + 1.002,
              });
          }
        }
        for (const x of xs) consider({ x, y: preferred.y });
        for (const y of ys) consider({ x: preferred.x, y });
        for (const x of xs) {
          for (const y of ys) consider({ x, y });
        }
        // The closest free location lies on a contact, an intersection, or an edge.
        for (let index = 0; index < contacts.length; index++) {
          const a = contacts[index];
          const angle = Math.atan2(preferred.y - a.y, preferred.x - a.x);
          consider({
            x: a.x + Math.cos(angle) * a.radius,
            y: a.y + Math.sin(angle) * a.radius,
          });
          for (const x of xs) {
            const squared = a.radius ** 2 - (x - a.x) ** 2;
            if (squared >= 0) {
              const dy = Math.sqrt(squared);
              consider({ x, y: a.y - dy });
              consider({ x, y: a.y + dy });
            }
          }
          for (const y of ys) {
            const squared = a.radius ** 2 - (y - a.y) ** 2;
            if (squared >= 0) {
              const dx = Math.sqrt(squared);
              consider({ x: a.x - dx, y });
              consider({ x: a.x + dx, y });
            }
          }
          for (let next = index + 1; next < contacts.length; next++) {
            const b = contacts[next];
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            if (
              !length ||
              length > a.radius + b.radius ||
              length < Math.abs(a.radius - b.radius)
            )
              continue;
            const along =
              (a.radius ** 2 - b.radius ** 2 + length ** 2) / (2 * length);
            const across = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
            const point = {
              x: a.x + (dx * along) / length,
              y: a.y + (dy * along) / length,
            };
            consider({
              x: point.x - (dy * across) / length,
              y: point.y + (dx * across) / length,
            });
            consider({
              x: point.x + (dy * across) / length,
              y: point.y - (dx * across) / length,
            });
          }
        }
      }
      if (!position) {
        unexpanded.add(circle.id);
        continue;
      }
      Object.assign(circle, position);
      packed.set(circle.id, circle);
      large.push(circle);
    }
    // Context dots yield visually, never by repacking or changing their star sizes.
    const exclusion = large.map(other => ({
      ...other,
      radius: other.radius + (packed.get(other.id)?.emphasis || 0) * 6 + 1.5,
    }));
    for (const item of circles.values()) {
      if (packed.has(item.id)) continue;
      const source = item;
      if (unexpanded.has(item.id)) {
        const opacity = source.opacity;
        Object.assign(source, this.nativeCircle(item.id, null), { opacity });
      }
      let opacity = source.opacity;
      for (const other of exclusion) {
        if (opacity <= 0.001) break;
        opacity = fadeOpacity(
          opacity,
          (source.x - other.x) ** 2 + (source.y - other.y) ** 2,
          source.radius + other.radius
        );
      }
      for (const label of obstacles.labels) {
        if (opacity <= 0.001) break;
        opacity = fadeOpacity(
          opacity,
          Math.max(Math.abs(source.x - label.x) - label.width / 2, 0) ** 2 +
            Math.max(Math.abs(source.y - label.y) - label.height / 2, 0) ** 2,
          source.radius + 1.5
        );
      }
      source.opacity = opacity;
    }
    return circles;
  }

  private drawContents(
    context: CanvasRenderingContext2D,
    repository: Repository,
    point: Point,
    radius: number
  ): void {
    const detail = circleDetail(radius);
    if (detail === 'none') return;
    const names = detail === 'names';
    const font = clamp(radius * 0.28, 10, 42);
    context.save();
    context.beginPath();
    context.arc(point.x, point.y, radius - 1.5, 0, Math.PI * 2);
    context.clip();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const widthAt = (offset: number, fontSize: number) =>
      2 *
      Math.sqrt(
        Math.max(0, (radius - 2) ** 2 - (Math.abs(offset) + fontSize / 2) ** 2)
      );
    if (names) {
      const name = (
        text: string,
        offset: number,
        weight: number,
        color: string
      ) => {
        const available = (metrics: TextMetrics) =>
          2 *
          Math.sqrt(
            Math.max(
              0,
              (radius - 2) ** 2 -
                Math.max(
                  Math.abs(offset - metrics.actualBoundingBoxAscent),
                  Math.abs(offset + metrics.actualBoundingBoxDescent)
                ) **
                  2
            )
          );
        const initial = weight === 700 ? font : clamp(radius * 0.24, 9.5, 38);
        let size = initial;
        context.font = `${weight} ${size}px system-ui, sans-serif`;
        const measured = context.measureText(text);
        if (measured.width <= available(measured)) {
          let low = size,
            high = Math.max(size, Math.min(48, radius * 0.4));
          for (let step = 0; step < 6; step++) {
            const middle = (low + high) / 2;
            context.font = `${weight} ${middle}px system-ui, sans-serif`;
            const measured = context.measureText(text);
            if (measured.width <= available(measured)) low = middle;
            else high = middle;
          }
          size = low;
        }
        context.font = `${weight} ${size}px system-ui, sans-serif`;
        context.fillStyle = color;
        const fitted = this.fitText(context, text, available);
        context.fillText(fitted, point.x, point.y + offset);
        if (weight === 700 && fitted) {
          const metrics = context.measureText(fitted);
          const left = point.x - metrics.actualBoundingBoxLeft;
          const right = point.x + metrics.actualBoundingBoxRight;
          const top = point.y + offset - metrics.actualBoundingBoxAscent;
          const bottom = point.y + offset + metrics.actualBoundingBoxDescent;
          context.beginPath();
          context.moveTo(left, bottom + 1);
          context.lineTo(right, bottom + 1);
          context.strokeStyle = color;
          context.lineWidth = 1;
          context.stroke();
          const labels =
            context === this.context ? this.baseNames : this.overlayNames;
          labels.set(repository.id, {
            x: (left + right) / 2,
            y: (top + bottom) / 2,
            width: right - left + 4,
            height: bottom - top + 4,
          });
        }
      };
      name(repository.owner, -radius * 0.42, 400, '#34425b');
      name(repository.name, 0, 700, '#101b30');
    }
    const starFont = clamp(radius * 0.21, 9, 30);
    const offset = names ? radius * 0.42 : 0;
    const maximum = widthAt(offset, starFont);
    context.font = `600 ${starFont}px system-ui, sans-serif`;
    const star = '\u2605';
    const starWidth = context.measureText(star).width;
    let count = fullStars.format(repository.stars);
    if (context.measureText(count).width + starWidth + 3 > maximum)
      count = compactStars.format(repository.stars);
    const countWidth = context.measureText(count).width;
    const total = countWidth + starWidth + 3;
    if (total <= maximum) {
      context.textAlign = 'left';
      context.fillStyle = '#101b30';
      context.fillText(count, point.x - total / 2, point.y + offset);
      context.fillStyle = starTier(repository.stars).textColor;
      context.fillText(
        star,
        point.x - total / 2 + countWidth + 3,
        point.y + offset
      );
    }
    context.restore();
  }

  private syncNameLinks(): void {
    const visible = new Set<string>();
    const obstacles = this.previewObstacles();
    const update = (id: string, bounds: LabelBox) => {
      if (
        bounds.x + bounds.width / 2 <= 0 ||
        bounds.x - bounds.width / 2 >= this.width ||
        bounds.y + bounds.height / 2 <= 0 ||
        bounds.y - bounds.height / 2 >= this.height ||
        obstacles.circles.some(
          circle =>
            Math.max(Math.abs(circle.x - bounds.x) - bounds.width / 2, 0) ** 2 +
              Math.max(Math.abs(circle.y - bounds.y) - bounds.height / 2, 0) **
                2 <
            circle.radius ** 2
        ) ||
        obstacles.labels.some(
          label =>
            Math.abs(label.x - bounds.x) < (label.width + bounds.width) / 2 &&
            Math.abs(label.y - bounds.y) < (label.height + bounds.height) / 2
        )
      ) {
        return;
      }
      const hit = this.hit(bounds);
      if (hit?.kind !== 'repository' || hit.repository.id !== id) return;
      visible.add(id);
      let entry = this.nameLinks.get(id);
      if (!entry) {
        const anchor = document.createElement('a');
        anchor.className = 'repository-name-link';
        anchor.dataset.repository = id;
        anchor.href = repositorySearch(hit.repository);
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.draggable = false;
        anchor.textContent = hit.repository.name;
        anchor.title = `Search get-cmake, run-cmake and run-vcpkg in ${id}`;
        anchor.setAttribute(
          'aria-label',
          `Search actions in ${id} (opens in a new tab)`
        );
        this.nameLayer.append(anchor);
        entry = { anchor, bounds: null };
        this.nameLinks.set(id, entry);
      }
      const { anchor, bounds: previous } = entry;
      anchor.hidden = false;
      if (
        previous?.x !== bounds.x ||
        previous?.y !== bounds.y ||
        previous?.width !== bounds.width ||
        previous?.height !== bounds.height
      ) {
        anchor.style.transform = `translate(${bounds.x -
          bounds.width / 2}px, ${bounds.y - bounds.height / 2}px)`;
        anchor.style.width = `${bounds.width}px`;
        anchor.style.height = `${bounds.height}px`;
        entry.bounds = bounds;
      }
    };
    // The base canvas is cached; only overlay records change on hover frames.
    for (const [id, bounds] of this.baseNames) {
      if (!this.displayed?.circles.has(id) && !this.overlayNames.has(id)) {
        update(id, bounds);
      }
    }
    for (const [id, bounds] of this.overlayNames) update(id, bounds);
    for (const [id, entry] of this.nameLinks) {
      if (visible.has(id)) continue;
      if (this.gesture?.link === entry.anchor && !this.gesture.moved) {
        entry.anchor.hidden = true;
        continue;
      }
      if (document.activeElement === entry.anchor) {
        this.overlay.focus({ preventScroll: true });
      }
      entry.anchor.remove();
      this.nameLinks.delete(id);
    }
  }

  private fitText(
    context: CanvasRenderingContext2D,
    text: string,
    width: number | ((metrics: TextMetrics) => number)
  ): string {
    const fits = (value: string) => {
      const metrics = context.measureText(value);
      return (
        metrics.width <= (typeof width === 'number' ? width : width(metrics))
      );
    };
    if (fits(text)) return text;
    const characters = Array.from(text);
    const ellipsis = '\u2026';
    let low = 0,
      high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(`${characters.slice(0, middle).join('')}${ellipsis}`))
        low = middle;
      else high = middle - 1;
    }
    return low ? `${characters.slice(0, low).join('')}${ellipsis}` : '';
  }

  private drawScene(): void {
    const context = this.context;
    this.prepare(context);
    this.baseNames.clear();
    if (!this.repositories.length) return;
    this.drawTriangle(context);
    for (const tier of STAR_TIERS) {
      context.beginPath();
      for (const repository of this.repositories) {
        if (starTier(repository.stars) !== tier) continue;
        const point = this.screen(repository);
        const radius = repository.radius * this.scale;
        if (!this.inView(point, radius)) continue;
        context.moveTo(point.x + radius, point.y);
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      }
      context.fillStyle = tier.color;
      context.fill();
    }
    for (const repository of this.repositories) {
      const point = this.screen(repository);
      const radius = repository.radius * this.scale;
      if (circleDetail(radius) !== 'none' && this.inView(point, radius)) {
        this.drawRepository(context, repository, point, radius);
      }
    }
    this.layout.hubs.forEach(hub => this.drawHub(context, hub));
  }

  private drawTriangle(context: CanvasRenderingContext2D): void {
    context.beginPath();
    this.layout.hubs.forEach((hub, index) => {
      const point = this.hubPosition(hub);
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.closePath();
    context.fillStyle = 'rgba(181, 160, 255, 0.035)';
    context.fill();
    context.strokeStyle = 'rgba(190, 207, 255, 0.22)';
    context.lineWidth = 1;
    context.stroke();
  }

  private hubRadius(): number {
    return actionHubRadius(this.width);
  }

  private hubPosition(hub: Hub): Point {
    return {
      x: (hub.x / this.layout.width) * this.width,
      y: (hub.y / this.layout.height) * this.height,
    };
  }

  private hubLabelPosition(hub: Hub): Point {
    const point = this.hubPosition(hub);
    return {
      x: point.x,
      y:
        point.y +
        (hub.action === 'run-cmake' ? 1 : -1) * (this.hubRadius() + 14),
    };
  }

  private drawHub(
    context: CanvasRenderingContext2D,
    hub: Hub,
    version?: string
  ): void {
    const point = this.hubPosition(hub);
    const radius = this.hubRadius();
    context.beginPath();
    context.arc(point.x, point.y, radius + 6, 0, Math.PI * 2);
    context.strokeStyle = `${hub.color}35`;
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = '#16223a';
    context.fill();
    context.strokeStyle = hub.color;
    context.lineWidth = 2;
    context.stroke();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = hub.color;
    context.font =
      version === undefined
        ? '700 17px system-ui, sans-serif'
        : '600 12px ui-monospace, monospace';
    context.fillText(
      version === undefined
        ? String(
            this.counts.find(count => count.action === hub.action)?.projects ||
              0
          )
        : this.fitText(context, version, radius * 2 - 12),
      point.x,
      point.y
    );
    context.fillStyle = '#f2f5ff';
    context.font = '600 13px system-ui, sans-serif';
    const label = this.hubLabelPosition(hub);
    context.fillText(hub.action, label.x, label.y);
  }

  private drawNavigationCue(
    circle: PreviewCircle | null,
    time: number
  ): boolean {
    if (!circle) {
      this.navigationCue = null;
      return false;
    }
    if (this.navigationCue?.id !== circle.id)
      this.navigationCue = { id: circle.id, started: time };
    if (this.reducedMotion.matches)
      this.navigationCue.started = time - NEXT_PULSE_DURATION;
    const progress = clamp(
      (time - this.navigationCue.started) / NEXT_PULSE_DURATION,
      0,
      1
    );
    const pulse = Math.sin(progress * Math.PI) ** 2;
    const context = this.highlight;
    context.save();
    context.globalAlpha = 1;
    context.beginPath();
    // The diameter pulse is decorative; layout and hit targets stay fixed.
    context.arc(
      circle.x,
      circle.y,
      Math.max(4, circle.radius) * (1 - 0.08 * pulse) + 2,
      0,
      Math.PI * 2
    );
    context.strokeStyle = '#b9f4ff';
    context.lineWidth = 2.5;
    context.stroke();
    context.restore();
    return progress < 1;
  }

  private drawHighlight(time: number): boolean {
    const context = this.highlight;
    this.prepare(context);
    this.overlayNames.clear();
    const pinned = this.selected ? this.byId.get(this.selected) : null;
    const hovered =
      this.hovered && this.hovered.kind === 'repository'
        ? this.hovered.repository
        : null;
    const repository = pinned || hovered;
    const action =
      this.hovered && this.hovered.kind === 'action' ? this.hovered.hub : null;
    const frame = this.displayed;
    if (!frame && !action && !hovered) {
      this.proximityCandidate = null;
      this.navigationCue = null;
      return false;
    }
    const next = this.nextRepository(time);
    context.fillStyle = `rgba(9, 17, 33, ${0.6 *
      Math.max(frame?.shade || 0, action ? 1 : 0)})`;
    context.fillRect(0, 0, this.width, this.height);
    if (action) {
      for (const item of this.repositories) {
        if (
          !frame?.circles.has(item.id) &&
          item.actions.includes(action.action) &&
          this.inView(this.screen(item), item.radius * this.scale)
        ) {
          this.drawRepository(
            context,
            item,
            this.screen(item),
            item.radius * this.scale
          );
        }
      }
    }
    const versionsByAction = new Map<ActionName, string>();
    if (frame) {
      context.beginPath();
      for (const mask of frame.masks) {
        context.moveTo(mask.x + mask.radius, mask.y);
        context.arc(mask.x, mask.y, mask.radius, 0, Math.PI * 2);
      }
      context.fillStyle = '#101b30';
      context.fill();
      this.drawTriangle(context);
      const batches = new Map<
        string,
        { color: string; opacity: number; circles: Circle[] }
      >();
      const focused = this.displayedLarge
        .filter(circle => circle.emphasis)
        .sort((left, right) => left.emphasis - right.emphasis);
      for (const circle of focused) {
        const item = this.byId.get(circle.id)!;
        context.globalAlpha = circle.emphasis;
        for (const hub of this.layout.hubs) {
          if (!item.actions.includes(hub.action)) continue;
          const target = this.hubPosition(hub);
          context.beginPath();
          context.moveTo(circle.x, circle.y);
          context.lineTo(target.x, target.y);
          context.strokeStyle = hub.color;
          context.lineWidth = 2;
          context.stroke();
        }
      }
      for (const circle of frame.circles.values()) {
        if (circle.opacity <= 0.001) continue;
        if (circle.emphasis) continue;
        if (!this.inView(circle, circle.radius)) continue;
        const item = this.byId.get(circle.id)!;
        if (circle.id === next?.id || circleDetail(circle.radius) !== 'none') {
          context.globalAlpha = circle.opacity;
          this.drawRepository(
            context,
            item,
            circle,
            circle.radius,
            circle.id === next?.id
          );
          continue;
        }
        const color = this.color(item);
        const key = `${color}:${circle.opacity}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { color, opacity: circle.opacity, circles: [] };
          batches.set(key, batch);
        }
        batch.circles.push(circle);
      }
      for (const batch of batches.values()) {
        context.beginPath();
        for (const circle of batch.circles) {
          context.moveTo(circle.x + circle.radius, circle.y);
          context.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        }
        context.globalAlpha = batch.opacity;
        context.fillStyle = batch.color;
        context.fill();
      }
      for (const circle of focused) {
        context.globalAlpha = circle.opacity;
        this.drawRepository(
          context,
          this.byId.get(circle.id)!,
          circle,
          circle.radius,
          circle.id === next?.id
        );
        context.globalAlpha = circle.emphasis;
        context.beginPath();
        context.arc(circle.x, circle.y, circle.radius + 4, 0, Math.PI * 2);
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2;
        context.stroke();
      }
      context.globalAlpha = 1;
      if (pinned && !frame.circles.has(pinned.id)) {
        this.drawRepository(context, pinned);
      }
    } else if (hovered && !action) {
      const point = this.screen(hovered);
      const radius = hovered.radius * this.scale;
      this.drawRepository(context, hovered, point, radius, true);
      context.beginPath();
      context.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.stroke();
    }
    if (repository && (!action || pinned)) {
      for (const hub of this.layout.hubs) {
        if (!repository.actions.includes(hub.action)) continue;
        const versions = Array.from(
          new Set(
            repository.usages
              .filter(usage => usage.action === hub.action)
              .map(usage => usage.version)
          )
        );
        versionsByAction.set(
          hub.action,
          `${versions[0]}${
            versions.length > 1 ? ` +${versions.length - 1}` : ''
          }`
        );
      }
    }
    const pulsing = this.drawNavigationCue(next, time);
    for (const hub of this.layout.hubs) {
      context.globalAlpha = action
        ? action.action === hub.action
          ? 1
          : 0.45
        : !repository || repository.actions.includes(hub.action)
        ? 1
        : 0.45;
      this.drawHub(context, hub, versionsByAction.get(hub.action));
    }
    context.globalAlpha = 1;
    return pulsing || this.proximityCandidate !== null;
  }
}
