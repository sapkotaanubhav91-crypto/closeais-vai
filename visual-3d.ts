/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser.js';

import * as THREE from 'three';
import {fs as sphereFS, vs as sphereVS} from './sphere-shader.js';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private sphere!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);
  private scene!: THREE.Scene;

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer = renderer;

    const geometry = new THREE.IcosahedronGeometry(1.5, 64);

    const sphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: {value: 0},
        inputData: {value: new THREE.Vector4()},
        outputData: {value: new THREE.Vector4()},
      },
      vertexShader: sphereVS,
      fragmentShader: sphereFS,
    });

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);

    this.sphere = sphere;

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60) || 1; // Guard against NaN on first frame
    this.prevTime = t;
    const sphereMaterial = this.sphere.material as THREE.ShaderMaterial;

    // Enhanced movement logic
    const outputLow = this.outputAnalyser.data[0] / 255;
    const outputMid = this.outputAnalyser.data[1] / 255;
    const inputMid = this.inputAnalyser.data[1] / 255;

    // 1. Pulsing scale based on output audio (low and mid frequencies).
    const pulse = 1 + 0.1 * outputLow + 0.15 * outputMid;
    this.sphere.scale.setScalar(pulse);

    // 2. Dynamic rotation of the sphere itself based on input and output.
    const rotationSpeedY = 0.002 * (inputMid + outputMid);
    const rotationSpeedX = 0.001 * outputLow;

    // Add a slow, continuous base rotation.
    this.sphere.rotation.y += 0.0002 * dt;
    // Add audio-driven rotation.
    this.sphere.rotation.y += rotationSpeedY * dt;
    this.sphere.rotation.x += rotationSpeedX * dt;

    // 3. Positional jitter based on output bass frequencies.
    const timeInSeconds = t * 0.001;
    const jitterAmount = 0.03 * outputLow;
    this.sphere.position.x = Math.sin(timeInSeconds * 20) * jitterAmount;
    this.sphere.position.y = Math.cos(timeInSeconds * 15) * jitterAmount;

    // 4. Decoupled, slow camera orbit for a stable but dynamic view.
    const f = 0.0001;
    this.rotation.y += dt * f;
    const euler = new THREE.Euler(0, this.rotation.y, 0);
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    const vector = new THREE.Vector3(0, 0, 5);
    vector.applyQuaternion(quaternion);
    this.camera.position.copy(vector);
    this.camera.lookAt(this.sphere.position); // Look at the jittering sphere.

    sphereMaterial.uniforms.time.value = t * 0.001;
    sphereMaterial.uniforms.inputData.value.set(
      (1 * this.inputAnalyser.data[0]) / 255,
      (0.1 * this.inputAnalyser.data[1]) / 255,
      (10 * this.inputAnalyser.data[2]) / 255,
      0,
    );
    sphereMaterial.uniforms.outputData.value.set(
      (2 * this.outputAnalyser.data[0]) / 255,
      (0.1 * this.outputAnalyser.data[1]) / 255,
      (10 * this.outputAnalyser.data[2]) / 255,
      0,
    );

    this.renderer.render(this.scene, this.camera);
  }

  protected firstUpdated() {
    // @google/genai-api: Fix: Use this.shadowRoot instead of this.renderRoot.
    this.canvas = this.shadowRoot!.querySelector('canvas')! as HTMLCanvasElement;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}