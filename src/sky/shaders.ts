export const starVertex = `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
varying float vAlpha;
void main() {
  vAlpha = 0.42 + 0.58 * (0.5 + 0.5 * sin(uTime * 1.25 + aPhase));
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (220.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const starFragment = `
precision mediump float;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float glow = exp(-d * 3.4);
  gl_FragColor = vec4(uColor, vAlpha * glow);
}
`;

export const nebulaVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const nebulaFragment = `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uNebula;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 uv = vUv;
  float n = noise(uv * 3.0 + uTime * 0.03);
  n += 0.5 * noise(uv * 7.0 - uTime * 0.02);
  vec3 field = mix(uA, uB, uv.y);
  field = mix(field, uC, n * 0.55);
  field = mix(field, uNebula, n * n * 0.35);
  gl_FragColor = vec4(field, 1.0);
}
`;
