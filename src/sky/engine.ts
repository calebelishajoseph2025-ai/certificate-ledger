import {
  AdditiveBlending,
  BufferGeometry,
  Clock,
  Color,
  Float32BufferAttribute,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import {skyPalette} from './palette';
import {publishSky, type SkyQuality} from './events';
import {nebulaFragment, nebulaVertex, starFragment, starVertex} from './shaders';
import type {ThemeName} from '@/theme/themes';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SkyEngineOptions {
  canvas: HTMLCanvasElement;
  theme: ThemeName;
  reducedMotion: boolean;
}

export class SkyEngine {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private clock = new Clock();
  private raf = 0;
  private disposed = false;
  private quality: SkyQuality = 'high';
  private reducedMotion: boolean;
  private theme: ThemeName;
  private starMat: ShaderMaterial;
  private nebulaMat: ShaderMaterial;
  private nebula: Mesh;
  private stars: Points;
  private frameTimes: number[] = [];
  private layerCount = 3;
  private observer?: ResizeObserver;
  private running = true;

  constructor(options: SkyEngineOptions) {
    this.theme = options.theme;
    this.reducedMotion = options.reducedMotion;
    const canvas = options.canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(new Color(0, 0, 0), 0);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 1, 0.1, 200);
    this.camera.position.z = 18;

    const palette = skyPalette(this.theme);
    this.nebulaMat = new ShaderMaterial({
      vertexShader: nebulaVertex,
      fragmentShader: nebulaFragment,
      uniforms: {
        uTime: {value: 0},
        uA: {value: palette.a},
        uB: {value: palette.b},
        uC: {value: palette.c},
        uNebula: {value: palette.nebula},
      },
      depthWrite: false,
    });
    this.nebula = new Mesh(new PlaneGeometry(48, 32), this.nebulaMat);
    this.nebula.position.z = -12;
    this.scene.add(this.nebula);

    const starGeo = this.buildStars(900);
    this.starMat = new ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: {
        uTime: {value: 0},
        uPixelRatio: {value: this.renderer.getPixelRatio()},
        uColor: {value: palette.star},
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.stars = new Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.loop();
    this.publish();
  }

  private buildStars(count: number): BufferGeometry {
    const rand = mulberry32(0x5eed1e);
    const positions: number[] = [];
    const sizes: number[] = [];
    const phases: number[] = [];
    for (let i = 0; i < count; i += 1) {
      positions.push((rand() - 0.5) * 40, (rand() - 0.5) * 24, (rand() - 0.5) * 16);
      sizes.push(1.2 + rand() * 3.4);
      phases.push(rand() * Math.PI * 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));
    return geo;
  }

  setTheme(theme: ThemeName) {
    this.theme = theme;
    const palette = skyPalette(theme);
    this.nebulaMat.uniforms.uA!.value = palette.a;
    this.nebulaMat.uniforms.uB!.value = palette.b;
    this.nebulaMat.uniforms.uC!.value = palette.c;
    this.nebulaMat.uniforms.uNebula!.value = palette.nebula;
    this.starMat.uniforms.uColor!.value = palette.star;
  }

  setReducedMotion(value: boolean) {
    this.reducedMotion = value;
    if (value) {
      this.quality = 'low';
      this.layerCount = 1;
      this.nebula.visible = false;
    } else if (this.quality === 'low') {
      this.nebula.visible = true;
    }
    this.publish();
  }

  private resize() {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement ?? canvas;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = window.requestAnimationFrame(this.loop);
    if (!this.running) return;
    const dt = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = avg > 0 ? 1 / avg : 60;
    this.govern(avg);

    const timeScale = this.reducedMotion ? 0 : 1;
    this.starMat.uniforms.uTime!.value = elapsed * timeScale;
    if (this.nebula.visible) {
      this.nebulaMat.uniforms.uTime!.value = elapsed * timeScale;
    }
    if (!this.reducedMotion) {
      this.stars.rotation.z = elapsed * 0.008;
    }
    this.renderer.render(this.scene, this.camera);
    if (Math.round(elapsed * 4) % 4 === 0) this.publish(fps);
  };

  private govern(avgDt: number) {
    if (this.reducedMotion) return;
    if (avgDt > 0.033 && this.quality === 'high') {
      this.quality = 'medium';
      this.nebula.visible = false;
      this.layerCount = 2;
    } else if (avgDt > 0.04 && this.quality === 'medium') {
      this.quality = 'low';
      this.stars.visible = true;
      this.layerCount = 1;
    }
  }

  pause() {
    this.running = false;
  }

  resume() {
    this.running = true;
  }

  private publish(fps = 60) {
    publishSky({
      fps: Math.round(fps),
      dpr: this.renderer.getPixelRatio(),
      quality: this.reducedMotion ? 'off' : this.quality,
      layerCount: this.layerCount,
      reducedMotion: this.reducedMotion,
      webgl: true,
    });
  }

  dispose() {
    this.disposed = true;
    window.cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.starMat.dispose();
    this.nebulaMat.dispose();
    this.stars.geometry.dispose();
    this.nebula.geometry.dispose();
    this.renderer.dispose();
  }
}
