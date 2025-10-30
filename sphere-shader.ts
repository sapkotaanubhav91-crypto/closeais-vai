/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
const vs = `#define STANDARD
varying vec3 vViewPosition;
varying vec3 vObjectNormal;
varying vec4 vInputData;
varying vec4 vOutputData;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float time;
uniform vec4 inputData;
uniform vec4 outputData;

vec3 calc( vec3 pos ) {
  vec3 dir = normalize( pos );
  vec3 p = dir + vec3( time, 0., 0. );
  return pos +
    1. * inputData.x * inputData.y * dir * (.5 + .5 * sin(inputData.z * pos.x + time)) +
    1. * outputData.x * outputData.y * dir * (.5 + .5 * sin(outputData.z * pos.y + time));
}

vec3 spherical( float r, float theta, float phi ) {
  return r * vec3(
    cos( theta ) * cos( phi ),
    sin( theta ) * cos( phi ),
    sin( phi )
  );
}

void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>

  float inc = 0.001;
  float r = length( position );
  float theta = ( uv.x + 0.5 ) * 2. * PI;
  float phi = -( uv.y + 0.5 ) * PI;

  vec3 np = calc( spherical( r, theta, phi ) );
  vec3 tangent = normalize( calc( spherical( r, theta + inc, phi ) ) - np );
  vec3 bitangent = normalize( calc( spherical( r, theta, phi + inc ) ) - np );
  transformedNormal = -normalMatrix * normalize( cross( tangent, bitangent ) );
  vNormal = normalize( transformedNormal );
  vObjectNormal = normal;

  transformed = np;

  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  vViewPosition = - mvPosition.xyz;

  vInputData = inputData;
  vOutputData = outputData;

  #include <fog_vertex>
}`;

const fs = `
precision highp float;

varying vec3 vObjectNormal;
varying vec4 vInputData;
varying vec4 vOutputData;
uniform float time;

// Simplex 2D noise
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
    float f = 0.0;
    f += 0.5000 * snoise(p); p = p * 2.02;
    f += 0.2500 * snoise(p); p = p * 2.03;
    f += 0.1250 * snoise(p); p = p * 2.01;
    f += 0.0625 * snoise(p);
    return f / 0.9375;
}

void main() {
  // Define colors for different states
  vec3 idleSkyColor = vec3(0.2, 0.7, 1.0); // Cool blue for idle
  vec3 listeningSkyColor = vec3(0.1, 0.8, 0.7); // Attentive teal for listening
  vec3 speakingSkyColor = vec3(0.4, 0.8, 1.0); // Brighter, active blue for speaking

  // Calculate intensity from audio data (using smoothstep for a nice falloff)
  float inputIntensity = smoothstep(0.0, 0.2, vInputData.y);
  float outputIntensity = smoothstep(0.0, 0.15, vOutputData.y);

  // Time-based pulse for the speaking animation to make it more dynamic
  float pulse = 0.5 + 0.5 * sin(time * 2.0);

  // Mix colors based on state
  vec3 skyColor = idleSkyColor;
  // Mix in listening color based on input intensity
  skyColor = mix(skyColor, listeningSkyColor, inputIntensity);
  // Mix in speaking color based on output intensity (with a pulse)
  skyColor = mix(skyColor, speakingSkyColor, outputIntensity * pulse);
  
  vec3 cloudColor = vec3(1.0, 0.98, 0.9);

  float audioInfluence = 0.1 + vOutputData.x * 0.5;
  float timeShift = time * 0.1 * (1.0 + audioInfluence * 5.0);

  float cloudiness = fbm(vObjectNormal.xy * 2.0 + timeShift);
  cloudiness = smoothstep(0.4, 0.6, cloudiness);

  vec3 finalColor = mix(skyColor, cloudColor, cloudiness);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export {fs, vs};