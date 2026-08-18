import * as THREE from 'three';

/**
 * Shared shader plumbing for everything that grows.
 *
 * Three separate problems are solved here, and they are solved once rather than
 * per material, because vegetation only reads as one living system if the trunk,
 * the branch, the leaf card, the grass blade and the distant imposter all lean
 * on the same gust at the same moment:
 *
 *  1. **Wind.** One global uniform block, updated once per frame by
 *     `VegetationSystem`, consumed by every foliage shader. The displacement is
 *     evaluated in *world* space so two neighbouring trees with different
 *     instance rotations still bend the same way.
 *
 *  2. **LOD cross-fade.** A per-instance `aFade` drives a noise-dither discard.
 *     Alpha blending would need back-to-front sorting that instanced foliage
 *     cannot give us; a per-pixel threshold gets the same "one level dissolves
 *     into the next" read for free, works with `alphaTest`, and leaves depth
 *     writes intact.
 *
 *  3. **Billboard imposters.** The furthest LOD is a camera-facing card sampling
 *     an atlas baked off the real mesh, so a tree at 300 m still has that tree's
 *     silhouette rather than a generic blob.
 *
 * Everything patches `MeshStandardMaterial` / `MeshBasicMaterial` through
 * `onBeforeCompile` instead of being a hand-rolled `ShaderMaterial`, which keeps
 * three's lighting, shadows, fog and tone mapping — and the sky system's fog
 * colour — working without reimplementation.
 */

/* ─────────────────────────── shared uniforms ─────────────────────────────── */

/**
 * The one wind state in the world. Uniform *objects* are shared by reference
 * across every patched material, so writing `.value` once updates them all.
 */
export const WIND_UNIFORMS = {
  /** Horizontal wind direction, normalised. */
  uWindDir: { value: new THREE.Vector2(0.83, 0.56) },
  /** Seconds. Kept separate from `ctx.state.elapsed` so it can be frozen. */
  uWindTime: { value: 0 },
  /** Overall amplitude multiplier. 1 = a calm breeze, ~2.6 = a storm. */
  uWindStrength: { value: 1.0 },
};

/**
 * Point the wind somewhere and set its force.
 * @param {number} angle  radians, world compass bearing
 * @param {number} strength
 */
export function setWind(angle, strength) {
  WIND_UNIFORMS.uWindDir.value.set(Math.cos(angle), Math.sin(angle));
  WIND_UNIFORMS.uWindStrength.value = strength;
}

export function advanceWind(dt) {
  WIND_UNIFORMS.uWindTime.value += dt;
}

/* ──────────────────────────────── GLSL ──────────────────────────────────── */

/**
 * `aWind` packs, per vertex:
 *   x  sway    0 at the anchored end, 1 at the most mobile tip
 *   y  phase   per-strand / per-card offset so nothing moves in lockstep
 *   z  flutter 0 for wood, 1 for a leaf card, ~0.4 for a grass blade
 */
const WIND_GLSL = /* glsl */`
  uniform vec2 uWindDir;
  uniform float uWindTime;
  uniform float uWindStrength;

  vec3 vegWind(vec3 worldPos, vec3 w, float instPhase) {
    float sway = w.x;
    if (sway <= 0.0) return vec3(0.0);
    float phase = w.y + instPhase;
    float t = uWindTime;

    // A long wave rolling across the landscape, so a whole hillside of trees
    // moves as one field rather than as unrelated objects.
    float travel = dot(worldPos.xz, uWindDir) * 0.052;
    float gustPhase = dot(worldPos.xz, uWindDir) * 0.0075 + t * 0.19;
    float gust = 0.58 + 0.42 * sin(gustPhase + phase * 0.21);

    float wave = sin(t * 0.62 + travel + phase)
               + 0.42 * sin(t * 1.31 - travel * 1.7 + phase * 1.7);
    float amp = uWindStrength * sway * gust * 0.055;

    vec3 dir3 = vec3(uWindDir.x, 0.0, uWindDir.y);
    vec3 off = dir3 * wave * amp;

    // Leaf and blade flutter: fast, small, mostly across the wind.
    if (w.z > 0.0) {
      float f = sin(t * 4.7 + phase * 5.1 + worldPos.y * 2.3)
              + sin(t * 7.9 + phase * 2.3 + worldPos.x * 3.1) * 0.6;
      vec3 cross3 = vec3(-uWindDir.y, 0.85, uWindDir.x);
      off += cross3 * f * w.z * sway * uWindStrength * 0.012;
    }

    // Branches pivot, they do not stretch: drop the tip as it leans out.
    off.y -= length(off.xz) * 0.26 * sway;
    return off;
  }
`;

/**
 * Interleaved gradient noise as the cross-fade threshold.
 *
 * A 4×4 Bayer matrix is the obvious choice and it is the wrong one: at the
 * screen size a mid-distance tree occupies, an ordered grid reads as a hard
 * checkerboard stencilled over the canopy, and a still frame makes it obvious.
 * IGN is low-discrepancy like Bayer but its pattern is fine, aperiodic grain
 * that hides inside foliage texture — which is exactly what a dissolve wants.
 */
const DITHER_GLSL = /* glsl */`
  float vegDither(vec2 fc) {
    return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  }
`;

/* ──────────────────────── foliage (wood / leaf / grass) ─────────────────── */

/**
 * Patch a `MeshStandardMaterial` so it sways with the global wind and
 * dither-dissolves on `aFade`.
 *
 * @param {THREE.Material} material
 * @param {object} [opts]
 * @param {boolean} [opts.worldUv]  derive UVs from world XZ (grass: ties every
 *                                  blade to the ground texture beneath it)
 * @param {number}  [opts.worldUvScale] metres per texture repeat
 * @param {number}  [opts.tipLight]  extra brightening toward the mobile tip
 * @param {boolean} [opts.monochrome] keep the map's silhouette and luminance but
 *                                  discard its hue, so `material.color` decides
 *                                  it outright (blossom off a green leaf card)
 */
export function patchFoliageMaterial(material, opts = {}) {
  const worldUv = !!opts.worldUv;
  const worldUvScale = opts.worldUvScale ?? 5.5;
  const tipLight = opts.tipLight ?? 0.0;
  const monochrome = !!opts.monochrome;
  const key = `veg-foliage-${worldUv ? 1 : 0}-${worldUvScale}-${tipLight}-${monochrome ? 1 : 0}`;
  // Grass takes its albedo UV from world XZ so a blade is literally coloured by
  // the ground texture it stands on. Only the base map does this; blades are
  // far too small for a normal or roughness map to earn its varying.
  const worldUvBlock = worldUv ? /* glsl */`
        #ifdef USE_MAP
          vMapUv = vegWorld.xz / uWorldUvScale;
        #endif
      ` : '';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WIND_UNIFORMS);
    shader.uniforms.uWorldUvScale = { value: worldUvScale };
    shader.uniforms.uTipLight = { value: tipLight };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec3 aWind;
        attribute float aPhase;
        attribute float aFade;
        uniform float uWorldUvScale;
        uniform float uTipLight;
        varying float vVegFade;
        ${WIND_GLSL}
      `)
      // Wind is applied in world space, which means intercepting the transform
      // rather than nudging `transformed` in object space.
      .replace('#include <project_vertex>', /* glsl */`
        vec4 vegLocal = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          vegLocal = instanceMatrix * vegLocal;
        #endif
        vec4 vegWorld = modelMatrix * vegLocal;
        vegWorld.xyz += vegWind(vegWorld.xyz, aWind, aPhase);
        vec4 mvPosition = viewMatrix * vegWorld;
        gl_Position = projectionMatrix * mvPosition;
        vVegFade = aFade;
${worldUvBlock}
      `)
      // …which also means the world position three derives for shadows and fog
      // has to be the displaced one, or leaves shadow themselves out of place.
      .replace('#include <worldpos_vertex>', /* glsl */`
        #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = vegWorld;
        #endif
      `);

    if (tipLight > 0) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>', /* glsl */`
        #include <color_vertex>
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          vColor.rgb *= 1.0 + uTipLight * aWind.x;
        #endif
      `);
    }

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying float vVegFade;
        ${DITHER_GLSL}
      `)
      .replace('#include <clipping_planes_fragment>', /* glsl */`
        #include <clipping_planes_fragment>
        if (vVegFade < 0.999 && vVegFade < vegDither(gl_FragCoord.xy)) discard;
      `);

    if (monochrome) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>', /* glsl */`
        #ifdef USE_MAP
          vec4 vegTexel = texture2D( map, vMapUv );
          float vegLum = dot( vegTexel.rgb, vec3( 0.32, 0.54, 0.14 ) );
          diffuseColor.rgb *= 0.30 + 1.05 * vegLum;
          diffuseColor.a *= vegTexel.a;
        #endif
      `);
    }
  };

  material.customProgramCacheKey = () => key;
  return material;
}

/* ────────────────────────────── imposters ───────────────────────────────── */

/**
 * The furthest LOD: one instanced quad per tree, always turned to the camera,
 * sampling the cell of the atlas baked from that tree's own mesh.
 *
 * Y stays world-up rather than following the camera's up vector — a spherical
 * billboard makes a forest visibly roll when the player looks up, and MM6's
 * camera is level almost all of the time anyway.
 *
 * @param {THREE.Texture} atlas
 */
export function makeImposterMaterial(atlas) {
  const material = new THREE.MeshBasicMaterial({
    map: atlas,
    transparent: false,
    alphaTest: 0.36,
    side: THREE.FrontSide,
    fog: true,
    depthWrite: true,
    toneMapped: true,
  });
  material.name = 'mat:veg-imposter';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WIND_UNIFORMS);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec4 aAtlas;
        attribute vec3 aSize;
        attribute float aFade;
        attribute float aPhase;
        varying float vVegFade;
        ${WIND_GLSL}
      `)
      .replace('#include <uv_vertex>', /* glsl */`
        #include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = aAtlas.xy + uv * aAtlas.zw;
        #endif
      `)
      .replace('#include <project_vertex>', /* glsl */`
        vec3 vegCentre = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        vec3 vegRight = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
        vegRight = normalize( vegRight );
        float vegUp01 = position.y + 0.5;
        vec3 vegWorldPos = vegCentre
          + vegRight * ( position.x * aSize.x )
          + vec3( 0.0, 1.0, 0.0 ) * ( position.y * aSize.y + aSize.z );
        vegWorldPos += vegWind( vegWorldPos, vec3( vegUp01 * vegUp01 * 0.6, 0.0, 0.0 ), aPhase );
        vec4 mvPosition = viewMatrix * vec4( vegWorldPos, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        vVegFade = aFade;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying float vVegFade;
        ${DITHER_GLSL}
      `)
      .replace('#include <clipping_planes_fragment>', /* glsl */`
        #include <clipping_planes_fragment>
        if (vVegFade < 0.999 && vVegFade < vegDither(gl_FragCoord.xy)) discard;
      `);
  };

  material.customProgramCacheKey = () => 'veg-imposter';
  return material;
}
