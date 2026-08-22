import{St as e,Y as t}from"./three-Bd1PvSFC.js";var n={uWindDir:{value:new e(.83,.56)},uWindTime:{value:0},uWindStrength:{value:1}};function r(e,t){n.uWindDir.value.set(Math.cos(e),Math.sin(e)),n.uWindStrength.value=t}function i(e){n.uWindTime.value+=e}var a=`
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
`,o=`
  float vegDither(vec2 fc) {
    return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  }
`;function s(e,t={}){let r=!!t.worldUv,i=t.worldUvScale??5.5,s=t.tipLight??0,c=!!t.monochrome,l=`veg-foliage-${+!!r}-${i}-${s}-${+!!c}`,u=r?`
        #ifdef USE_MAP
          vMapUv = vegWorld.xz / uWorldUvScale;
        #endif
      `:``;return e.onBeforeCompile=e=>{Object.assign(e.uniforms,n),e.uniforms.uWorldUvScale={value:i},e.uniforms.uTipLight={value:s},e.vertexShader=e.vertexShader.replace(`#include <common>`,`
        #include <common>
        attribute vec3 aWind;
        attribute float aPhase;
        attribute float aFade;
        uniform float uWorldUvScale;
        uniform float uTipLight;
        varying float vVegFade;
        ${a}
      `).replace(`#include <project_vertex>`,`
        vec4 vegLocal = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          vegLocal = instanceMatrix * vegLocal;
        #endif
        vec4 vegWorld = modelMatrix * vegLocal;
        vegWorld.xyz += vegWind(vegWorld.xyz, aWind, aPhase);
        vec4 mvPosition = viewMatrix * vegWorld;
        gl_Position = projectionMatrix * mvPosition;
        vVegFade = aFade;
${u}
      `).replace(`#include <worldpos_vertex>`,`
        #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = vegWorld;
        #endif
      `),s>0&&(e.vertexShader=e.vertexShader.replace(`#include <color_vertex>`,`
        #include <color_vertex>
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          vColor.rgb *= 1.0 + uTipLight * aWind.x;
        #endif
      `)),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`
        #include <common>
        varying float vVegFade;
        ${o}
      `).replace(`#include <clipping_planes_fragment>`,`
        #include <clipping_planes_fragment>
        if (vVegFade < 0.999 && vVegFade < vegDither(gl_FragCoord.xy)) discard;
      `),c&&(e.fragmentShader=e.fragmentShader.replace(`#include <map_fragment>`,`
        #ifdef USE_MAP
          vec4 vegTexel = texture2D( map, vMapUv );
          float vegLum = dot( vegTexel.rgb, vec3( 0.32, 0.54, 0.14 ) );
          diffuseColor.rgb *= 0.30 + 1.05 * vegLum;
          diffuseColor.a *= vegTexel.a;
        #endif
      `))},e.customProgramCacheKey=()=>l,e}function c(e){let r=new t({map:e,transparent:!1,alphaTest:.36,side:0,fog:!0,depthWrite:!0,toneMapped:!0});return r.name=`mat:veg-imposter`,r.onBeforeCompile=e=>{Object.assign(e.uniforms,n),e.vertexShader=e.vertexShader.replace(`#include <common>`,`
        #include <common>
        attribute vec4 aAtlas;
        attribute vec3 aSize;
        attribute float aFade;
        attribute float aPhase;
        varying float vVegFade;
        ${a}
      `).replace(`#include <uv_vertex>`,`
        #include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = aAtlas.xy + uv * aAtlas.zw;
        #endif
      `).replace(`#include <project_vertex>`,`
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
      `),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`
        #include <common>
        varying float vVegFade;
        ${o}
      `).replace(`#include <clipping_planes_fragment>`,`
        #include <clipping_planes_fragment>
        if (vVegFade < 0.999 && vVegFade < vegDither(gl_FragCoord.xy)) discard;
      `)},r.customProgramCacheKey=()=>`veg-imposter`,r}export{n as WIND_UNIFORMS,i as advanceWind,c as makeImposterMaterial,s as patchFoliageMaterial,r as setWind};