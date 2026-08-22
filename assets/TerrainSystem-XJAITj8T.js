import{Ct as e,H as t,J as n,M as r,Z as i,b as a,h as o,m as s,ot as c,w as l,wt as u}from"./three-Bd1PvSFC.js";import{t as d}from"./index-BotfF7-v.js";import{g as f}from"./Regions-YbEy1U_v.js";import{n as p}from"./MaterialLibrary-qfHIUyuW.js";import{LANDMARKS as m,WORLD_SIZE as h,generateTerrain as g}from"./TerrainGen-DtBCP4t7.js";var _=8,v=h/_,y=65,b=5,x=24,S=[282,576,1152,1800],C={grass:4,dirt:4.5,rock:8,sand:4},w={grass:[.92,1,1.2],dirt:[1.11,.93,1.34],rock:[1.02,1,1.06],sand:[1.08,1,1]},T={grass:1.85,dirt:2.05,rock:1.45,sand:1.35},E={grass:.155,dirt:.102,rock:.14,sand:.185},D=.42,O=.12,k=.5,A=.72,j=.26,M=.534,N=class extends d{static id=`terrain`;static order=20;constructor(){super(),this.data=null,this.worldSize=h,this.group=null,this.material=null,this.chunks=[],this._ready=!1,this._tmpVec=new e}async init(e){this.data=g(e.rng.fork(`terrain`));let t=await p(e.renderer,e.config.quality);this.material=this._buildMaterial(e,t),this.group=new r,this.group.name=`terrain`,this._buildChunks(),e.scene.add(this.group),this._registerColliders(e),this._registerShots(e),this._ready=!0}heightAt(e,t){return this.data?this.data.heightAt(e,t):0}normalAt(t,n){let r=this.data?this.data.normalAt(t,n):[0,1,0];return new e(r[0],r[1],r[2])}slopeAt(e,t){return this.data?this.data.slopeAt(e,t):0}biomeAt(e,t){return this.data?this.data.biomeAt(e,t):`grass`}isWater(e,t){return this.data?this.data.isWater(e,t):!1}roadAt(e,t){return this.data?this.data.roadAt(e,t):0}landmark(e){let t=m[e];return t?{x:t.x,z:t.z,y:this.heightAt(t.x,t.z),radius:t.radius}:null}isSettled(){return this._ready}_buildMaterial(t,n){let r=[`grass`,`dirt`,`rock`,`sand`],a=r.map(e=>n?.getTextures?.(e)??null),o=!!t.config?.leanTerrain;this._lean=o;let s=new i({color:16777215,roughness:1,metalness:0,vertexColors:!0}),c=this._buildSplatTexture(),l=this._buildHorizonTextures(),d={uSplat:{value:c},uRegion:{value:this._buildRegionTexture()},uHorizonA:{value:l[0]},uHorizonB:{value:l[1]},uSunDir:{value:new e(.35,.88,.32)},uSunShadow:{value:0},uWorldSize:{value:h},uLayerScale:{value:new u(C.grass,C.dirt,C.rock,C.sand)},uLayerTint:{value:r.map(t=>new e(...w[t]))},uLayerContrast:{value:new u(...r.map(e=>T[e]))},uLayerPivot:{value:new u(...r.map(e=>E[e]))}};for(let e=0;e<4;e++)d[`uAlbedo${e}`]={value:a[e]?.map??null},!o&&(d[`uNormal${e}`]={value:a[e]?.normalMap??null},d[`uOrm${e}`]={value:a[e]?.ormMap??null},d[`uHeight${e}`]={value:a[e]?.heightMap??null});return this._splatReady=a.every(e=>e&&e.map),this._uniforms=d,s.onBeforeCompile=e=>{Object.assign(e.uniforms,d),this._shader=e,this._splatReady&&(e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
          varying vec3 vTerrainWorld;
        `).replace(`#include <worldpos_vertex>`,`#include <worldpos_vertex>
          vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
          varying vec3 vTerrainWorld;
          uniform sampler2D uSplat;
          uniform sampler2D uRegion;
          // Set in <map_fragment>, read in <roughnessmap_fragment>, which
          // three.js emits later in the same main(). Globals rather than a
          // varying: both are fragment-local quantities.
          float gTerrainSnow = 0.0;
          float gTerrainWet = 0.0;
          uniform sampler2D uHorizonA;
          uniform sampler2D uHorizonB;
          uniform vec3 uSunDir;
          uniform float uSunShadow;
          uniform float uWorldSize;
          uniform vec4 uLayerScale;
          uniform vec3 uLayerTint[4];
          uniform vec4 uLayerContrast;
          uniform vec4 uLayerPivot;

          /**
           * Value noise, world-space, used only to tear the boundary between
           * two materials — never to add value variation. Our grass already
           * carries roughly twice MM6's within-patch spread; what it lacked
           * was a broken *edge*, which is a different quantity and the one the
           * reviewer named ("a hard aliased line where grass meets earth").
           */
          float tHash(vec2 p) {
            p = fract(p * vec2(127.113, 311.717));
            p += dot(p, p + 41.317);
            return fract(p.x * p.y);
          }
          float tNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                       mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }

          uniform sampler2D uAlbedo0, uAlbedo1, uAlbedo2, uAlbedo3;
          ${o?``:`
          uniform sampler2D uNormal0, uNormal1, uNormal2, uNormal3;
          uniform sampler2D uOrm0, uOrm1, uOrm2, uOrm3;
          uniform sampler2D uHeight0, uHeight1, uHeight2, uHeight3;
          `}

          /**
           * Expand a layer's own contrast about its mean, then grade it.
           *
           * The curve is applied to *luminance* and the result scaled back
           * onto the original chroma. Running pow() on each channel instead
           * looks equivalent and is not: a texel's channels sit at very
           * different distances from a single pivot, so the exponent pulls
           * them apart and the operation becomes a saturation control. On
           * ground textures — whose blue channel is far below the pivot on
           * both grass and dirt — it crushed blue specifically, and the whole
           * world went poster-green. Measured, that mistake cost 12% of the
           * frame's blue while barely moving the contrast it was there to fix.
           */
          vec3 gradeLayer(vec3 c, float gain, float pivot, vec3 tint) {
            float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
            float ye = pivot * pow(max(y, 1e-4) / pivot, gain);
            return c * (ye / max(y, 1e-4)) * tint;
          }

          /**
           * Height-weighted blend. A linear lerp cross-fades two materials into
           * mush; biasing by each layer's own displacement lets the higher
           * surface win locally, so gravel shows through grass at the boundary
           * the way it does on real ground.
           */
          vec4 heightBlend(vec4 w, vec4 h) {
            vec4 b = w * (h + 0.36);
            float m = max(max(b.x, b.y), max(b.z, b.w));
            b = max(b - (m - 0.22), 0.0);
            return b / max(dot(b, vec4(1.0)), 1e-4);
          }
        `).replace(`#include <map_fragment>`,`
          vec2 splatUv = vTerrainWorld.xz / uWorldSize + 0.5;
          vec4 sw = texture2D(uSplat, splatUv);
          sw /= max(dot(sw, vec4(1.0)), 1e-4);

          // ── strays along the grass/earth boundary ──────────────────────
          // The splat map is one texel per 4 m heightfield sample, filtered
          // linearly, so every material boundary was a smooth 4 m ramp that
          // the height blend then snapped into a hard curve — a clean line
          // through open ground, which nothing on real ground does. Two
          // octaves of world-space noise displace the grass/earth balance by
          // up to most of its range, but *only* where the two are already
          // close to even -- seam peaks at a 50/50 mix and vanishes inside
          // either material -- so pure grass stays pure and the boundary
          // breaks into islands and fingers instead of a curve.
          float tear = (tNoise(vTerrainWorld.xz * 0.42) - 0.5) * 1.55
                     + (tNoise(vTerrainWorld.xz * 0.13 + 17.0) - 0.5) * 1.05;
          float seam = 4.0 * sw.x * sw.y;
          float shift = tear * seam * 0.45;
          sw.x = clamp(sw.x - shift, 0.0, 1.0);
          sw.y = clamp(sw.y + shift, 0.0, 1.0);
          sw /= max(dot(sw, vec4(1.0)), 1e-4);

          // ── the terrain's own horizon, baked in eight directions ───────
          vec4 hzA = texture2D(uHorizonA, splatUv);
          vec4 hzB = texture2D(uHorizonB, splatUv);
          float hv[8];
          hv[0] = hzA.x; hv[1] = hzA.y; hv[2] = hzA.z; hv[3] = hzA.w;
          hv[4] = hzB.x; hv[5] = hzB.y; hv[6] = hzB.z; hv[7] = hzB.w;
          // Mean sine of the horizon = the share of the sky dome this sample
          // cannot see. Open ground reads 0 and is left alone; see AO_OPEN.
          float hzMean = (hzA.x + hzA.y + hzA.z + hzA.w
                        + hzB.x + hzB.y + hzB.z + hzB.w) * 0.125;
          float terrainOcc = clamp((hzMean - ${O.toFixed(3)}) / ${k.toFixed(3)}, 0.0, 1.0);
          // Horizon toward the sun's azimuth: exactly two of the eight
          // directions carry weight, so this is a linear interpolation
          // between neighbours on the compass rose.
          float sunK = atan(uSunDir.x, uSunDir.z) * (4.0 / PI);
          float hzSun = 0.0;
          for (int i = 0; i < 8; i++) {
            float dd = float(i) - sunK;
            dd = dd - 8.0 * floor(dd / 8.0 + 0.5);
            hzSun += hv[i] * max(0.0, 1.0 - abs(dd));
          }
          // uSunDir.y *is* the sine of the sun's elevation, so the shadow test
          // is a straight comparison against the baked sine. The ramp is a few
          // hundredths wide: a hard step aliases along every ridge line.
          float terrainSun = mix(1.0,
            smoothstep(-0.030, 0.075, uSunDir.y - hzSun), uSunShadow);

          vec2 uv0 = vTerrainWorld.xz / uLayerScale.x;
          vec2 uv1 = vTerrainWorld.xz / uLayerScale.y;
          vec2 uv2 = vTerrainWorld.xz / uLayerScale.z;
          vec2 uv3 = vTerrainWorld.xz / uLayerScale.w;

          // Rock is the layer that lands on cliffs, so it is the one that needs
          // triplanar projection; the rest lie flat enough for planar UVs.
          vec3 gnorm = normalize(vNormal);
          float vertical = 1.0 - abs(gnorm.y);
          vec2 uv2x = vTerrainWorld.zy / uLayerScale.z;
          vec2 uv2z = vTerrainWorld.xy / uLayerScale.z;
          vec3 rockPlanar = texture2D(uAlbedo2, uv2).rgb;
          vec3 rockX = texture2D(uAlbedo2, uv2x).rgb;
          vec3 rockZ = texture2D(uAlbedo2, uv2z).rgb;
          vec3 rockTri = mix(rockX, rockZ, abs(gnorm.z) / max(abs(gnorm.x) + abs(gnorm.z), 1e-4));

          ${o?`
          // No height maps to blend by, so the variation is synthesised at
          // each layer's own tiling frequency. What heightBlend needs is a
          // per-layer field that differs between neighbours, not the specific
          // displacement of that material — the boundary still tears into
          // islands and fingers, which is the whole point of the operation.
          vec4 hh = vec4(
            tNoise(uv0 * 3.0),
            tNoise(uv1 * 3.0 + 5.31),
            tNoise(uv2 * 3.0 + 11.77),
            tNoise(uv3 * 3.0 + 23.09)
          );
          `:`
          vec4 hh = vec4(
            texture2D(uHeight0, uv0).r,
            texture2D(uHeight1, uv1).r,
            texture2D(uHeight2, uv2).r,
            texture2D(uHeight3, uv3).r
          );
          `}
          vec4 bw = heightBlend(sw, hh);

          // Each layer is graded on its own before the blend, so a boundary
          // fades between two *corrected* materials. Grading the blended
          // result instead would tint grass by however much dirt happened to
          // be under it, which smears the very grass/dirt separation the
          // grade exists to widen.
          vec3 albedo =
              gradeLayer(texture2D(uAlbedo0, uv0).rgb, uLayerContrast.x, uLayerPivot.x, uLayerTint[0]) * bw.x
            + gradeLayer(texture2D(uAlbedo1, uv1).rgb, uLayerContrast.y, uLayerPivot.y, uLayerTint[1]) * bw.y
            + gradeLayer(mix(rockPlanar, rockTri, smoothstep(0.35, 0.8, vertical)), uLayerContrast.z, uLayerPivot.z, uLayerTint[2]) * bw.z
            + gradeLayer(texture2D(uAlbedo3, uv3).rgb, uLayerContrast.w, uLayerPivot.w, uLayerTint[3]) * bw.w;

          // A mud lip where grass gives way to earth. Real ground does not
          // change material along a clean join: the grass thins, the soil
          // under it shows damp and dark, and only then does bare earth take
          // over. This is the same 50/50 weighting the strays use, applied
          // after the height blend so it follows the *torn* boundary rather
          // than the splat map's smooth one.
          float lip = 4.0 * bw.x * bw.y;
          albedo *= mix(vec3(1.0), vec3(0.84, 0.78, 0.70), lip * 0.42);

          // ── regional character ─────────────────────────────────────────
          // See _buildRegionTexture. All four terms are zero in the Millhaven
          // Downs by construction, so nothing below can move a graded frame.
          vec4 rgn = texture2D(uRegion, splatUv);

          // Peat. Standing water and rotting leaf litter darken ground and
          // pull it green; it collects on low flat land and never on a face,
          // which is why the swamp regions read wet and the fen edges do not.
          float wet = rgn.y
            * (1.0 - smoothstep(12.0, 52.0, vTerrainWorld.y))
            * (1.0 - smoothstep(0.14, 0.40, vertical));
          albedo = mix(albedo, albedo * vec3(0.68, 0.80, 0.62), clamp(wet * 1.5, 0.0, 0.62));

          // Sun-bleached ground: warmer, brighter, and much lower in chroma —
          // the desert reads pale because its materials have lost colour, not
          // because a yellow filter was laid over them.
          float arid = clamp(rgn.z * 1.25, 0.0, 0.7);
          float aridGrey = dot(albedo, vec3(0.299, 0.587, 0.114));
          albedo = mix(albedo, mix(albedo, vec3(aridGrey), 0.55) * vec3(1.16, 1.07, 0.90), arid);

          // Verdancy, signed about 0.5. Above the downs the ground reads as a
          // closed canopy floor — cooler, deeper green. Below it the cover is
          // failing and stone is showing through: chroma drops and the whole
          // surface warms toward the rock under it.
          float verd = rgn.w * 2.0 - 1.0;
          float bareGrey = dot(albedo, vec3(0.299, 0.587, 0.114));
          albedo = mix(albedo, albedo * vec3(0.86, 0.97, 0.84), clamp(verd * 1.4, 0.0, 0.5));
          albedo = mix(albedo,
            mix(albedo, vec3(bareGrey), 0.34) * vec3(1.06, 1.00, 0.93),
            clamp(-verd * 1.1, 0.0, 0.55));

          // A real snowline. The share sets the altitude it starts at — a
          // region with no snow in its mix gets a mask identically zero at
          // every height, so this term costs the other seventeen regions
          // nothing. Snow lies on the flat and slides off a face.
          float snowLo = mix(340.0, 76.0, clamp(rgn.x * 1.7, 0.0, 1.0));
          float snowMask = clamp(rgn.x * 2.2, 0.0, 1.0)
            * smoothstep(snowLo, snowLo + 46.0, vTerrainWorld.y)
            * (1.0 - smoothstep(0.34, 0.66, vertical));
          albedo = mix(albedo, vec3(0.79, 0.83, 0.90), snowMask * 0.92);
          gTerrainSnow = snowMask;
          gTerrainWet = wet;

          // diffuseColor is declared further up main(); assign, never redeclare.
          // <color_fragment> runs after this and applies vColor itself, so the
          // macro tint must not be multiplied in here as well.
          diffuseColor = vec4(albedo, opacity);
        `).replace(`#include <roughnessmap_fragment>`,`
          ${o?`
          // No ORM set. Ground is rough by definition and the material's own
          // roughness is already 1.0; what actually reads on screen is the wet
          // and snow modulation below, which is regional and stays.
          //
          // The RED channel is not free in the same way, and pinning it at 1.0
          // was a bug. <aomap_fragment> below reads \`orm.r\` as the baked
          // terrain occlusion, so a flat 1.0 threw that away and lit the phone
          // brighter than the desktop the lighting was directed on — +6% of
          // ground luminance at noon, +30% at 22:00. LEAN_AO is the measured
          // mean of the four baked occlusion maps; see its own comment.
          vec3 orm = vec3(${M.toFixed(3)}, 1.0, 1.0);
          float roughnessFactor = roughness;
          `:`
          vec3 orm =
              texture2D(uOrm0, uv0).rgb * bw.x
            + texture2D(uOrm1, uv1).rgb * bw.y
            + texture2D(uOrm2, uv2).rgb * bw.z
            + texture2D(uOrm3, uv3).rgb * bw.w;
          float roughnessFactor = roughness * clamp(orm.g, 0.06, 1.0);
          `}
          // Wet ground holds a sheen; snow does not. Without this the two
          // would be colour swaps and nothing more, which is the trap this
          // whole pass exists to avoid.
          roughnessFactor = mix(roughnessFactor, 0.42, clamp(gTerrainWet * 1.3, 0.0, 0.55));
          roughnessFactor = mix(roughnessFactor, 0.93, gTerrainSnow * 0.9);
        `).replace(`#include <normal_fragment_maps>`,o?`#include <normal_fragment_maps>`:`
          vec3 tn =
              texture2D(uNormal0, uv0).xyz * bw.x
            + texture2D(uNormal1, uv1).xyz * bw.y
            + texture2D(uNormal2, uv2).xyz * bw.z
            + texture2D(uNormal3, uv3).xyz * bw.w;
          tn = tn * 2.0 - 1.0;
          // Whiteout blend against the geometric normal: keeps detail without
          // the flattening a plain replace causes on sloped ground.
          vec3 nBase = normalize(normal);
          normal = normalize(vec3(nBase.xy + tn.xy * 0.85, nBase.z * tn.z));
          normal = normalize(mix(nBase, normal, 0.85));
        `).replace(`#include <aomap_fragment>`,`
          float terrainAO = clamp(orm.r, 0.0, 1.0);
          reflectedLight.indirectDiffuse *= mix(1.0, terrainAO, 0.75);
          // Landform lighting. This chunk runs after <lights_fragment_end> and
          // before the diffuse sum, which is the only place the direct and
          // indirect terms are still separable — and they have to be, because
          // a hillside in its own shadow keeps the sky's fill and loses the
          // sun, which is precisely the value step that says where the sun is.
          reflectedLight.indirectDiffuse *= 1.0 - ${A.toFixed(3)} * terrainOcc;
          reflectedLight.directDiffuse *= mix(${D.toFixed(3)}, 1.0, terrainSun)
                                        * (1.0 - ${j.toFixed(3)} * terrainOcc);
        `))},s.customProgramCacheKey=()=>`terrain-splat-${+!!this._splatReady}-${o?`lean`:`full`}`,s}_buildSplatTexture(){let e=new Uint8Array(1052676),n=this.data.splat;for(let t=0;t<263169;t++)e[t*4+0]=Math.round(n[t*4+0]*255),e[t*4+1]=Math.round(n[t*4+1]*255),e[t*4+2]=Math.round(n[t*4+2]*255),e[t*4+3]=Math.round(n[t*4+3]*255);let r=new l(e,513,513,c);return r.needsUpdate=!0,r.wrapS=r.wrapT=a,r.minFilter=t,r.magFilter=t,r.colorSpace=``,r.generateMipmaps=!1,r}_buildRegionTexture(){let e=h/2,n=f(-1536,1536,2048)?.biomes??{},r=e=>({snow:e.snow??0,wet:(e.swamp??0)+(e.water??0)*.5,arid:(e.sand??0)+(e.rock??0)*.4,verd:(e.forest??0)+(e.grass??0)*.5}),i=r(n),o=new Float32Array(36864);for(let t=0;t<96;t++)for(let a=0;a<96;a++){let s=(a+.5)/96*h-e,c=(t+.5)/96*h-e,l=r(f(s,c,2048)?.biomes??n),u=(t*96+a)*4;o[u+0]=Math.max(0,l.snow-i.snow),o[u+1]=Math.max(0,l.wet-i.wet),o[u+2]=Math.max(0,l.arid-i.arid),o[u+3]=.5+Math.max(-.5,Math.min(.5,l.verd-i.verd))*.5}let s=new Float32Array(o.length),u=(e,t)=>(Math.min(95,Math.max(0,t))*96+Math.min(95,Math.max(0,e)))*4;for(let e=0;e<3;e++){for(let e=0;e<96;e++)for(let t=0;t<96;t++){let n=(e*96+t)*4;for(let r=0;r<4;r++){let i=0;for(let n=-1;n<=1;n++)for(let a=-1;a<=1;a++)i+=o[u(t+a,e+n)+r];s[n+r]=i/9}}o.set(s)}let d=new Uint8Array(36864);for(let e=0;e<d.length;e++)d[e]=Math.round(Math.min(1,o[e])*255);let p=new l(d,96,96,c);return p.needsUpdate=!0,p.wrapS=p.wrapT=a,p.minFilter=t,p.magFilter=t,p.colorSpace=``,p.generateMipmaps=!1,p}_buildHorizonTextures(){let e=this.data.horizon,n=n=>{let r=new Uint8Array(1052676);for(let t=0;t<263169;t++){let i=t*8+n;r[t*4+0]=e[i],r[t*4+1]=e[i+1],r[t*4+2]=e[i+2],r[t*4+3]=e[i+3]}let i=new l(r,513,513,c);return i.needsUpdate=!0,i.wrapS=i.wrapT=a,i.minFilter=t,i.magFilter=t,i.colorSpace=``,i.generateMipmaps=!1,i};return this._horizonTex=[n(0),n(4)],this._horizonTex}_buildChunks(){let t=h/2,r=this._buildLodIndices();for(let i=0;i<_;i++)for(let a=0;a<_;a++){let o=a*v-t,s=i*v-t,c=this._buildChunkGeometry(o,s,r),l=new n(c,this.material);l.position.set(0,0,0),l.castShadow=!1,l.receiveShadow=!0,l.frustumCulled=!0,l.userData.chunk={cx:a,cz:i,originX:o,originZ:s},this.group.add(l),this.chunks.push({mesh:l,geom:c,lodIndex:r,centre:new e(o+v/2,this.data.heightAt(o+v/2,s+v/2),s+v/2),level:-1})}}_buildLodIndices(){let e=4225,t=e=>{let t=64/e,n=(t,n)=>n*e*y+t*e,r=[];for(let e=0;e<=t;e++)r.push(n(e,0));for(let e=1;e<=t;e++)r.push(n(t,e));for(let e=t-1;e>=0;e--)r.push(n(e,t));for(let e=t-1;e>=1;e--)r.push(n(0,e));return r},n=new Map,r=t(1);for(let e=0;e<r.length;e++)n.set(r[e],e);let i=[];for(let r=0;r<b;r++){let a=1<<r,o=64/a,s=[],c=(e,t)=>t*a*y+e*a;for(let e=0;e<o;e++)for(let t=0;t<o;t++){let n=c(t,e),r=c(t+1,e),i=c(t,e+1),a=c(t+1,e+1);s.push(n,i,r,r,i,a)}let l=t(a);for(let t=0;t<l.length;t++){let r=l[t],i=l[(t+1)%l.length],a=e+n.get(r),o=e+n.get(i);s.push(r,a,i,i,a,o)}i.push({index:new Uint32Array(s),ring:l,count:s.length})}return i}_buildChunkGeometry(e,t,n){let r=4225,i=r+n[0].ring.length,a=new Float32Array(i*3),c=new Float32Array(i*3),l=new Float32Array(i*3),u=v/64;for(let n=0;n<y;n++)for(let r=0;r<y;r++){let i=n*y+r,o=e+r*u,s=t+n*u,d=this.data.heightAt(o,s);a[i*3+0]=o,a[i*3+1]=d,a[i*3+2]=s;let f=this.data.normalAt(o,s);c[i*3+0]=f[0],c[i*3+1]=f[1],c[i*3+2]=f[2];let p=this._macroTint(o,s,d);l[i*3+0]=p[0],l[i*3+1]=p[1],l[i*3+2]=p[2]}let d=n[0].ring;for(let e=0;e<d.length;e++){let t=d[e],n=r+e;a[n*3+0]=a[t*3+0],a[n*3+1]=a[t*3+1]-x,a[n*3+2]=a[t*3+2],c[n*3+0]=c[t*3+0],c[n*3+1]=c[t*3+1],c[n*3+2]=c[t*3+2],l[n*3+0]=l[t*3+0],l[n*3+1]=l[t*3+1],l[n*3+2]=l[t*3+2]}let f=new o;return f.setAttribute(`position`,new s(a,3)),f.setAttribute(`normal`,new s(c,3)),f.setAttribute(`color`,new s(l,3)),f.setIndex(new s(n[0].index,1)),f.computeBoundingSphere(),f}_macroTint(e,t,n){let r=Math.sin(e*.0331*.5+t*.0189*.5+.7),i=Math.sin(e*.014+t*.0078)*.5+Math.sin(e*.0061-t*.0133+2.3)*.5,a=Math.sin(e*.007-t*.0052+2.1),o=Math.sin(e*85e-5+t*61e-5-1.1),s=.5+.5*Math.sin(e*.0032+1.3)*Math.cos(t*.0027-.4),c=Math.min(1,Math.max(0,(n-10)/140)),l=r*.077+i*.161+a*.119+o*.084,u=.3,d=1.55,f=e=>e<u?u:e>d?d:e;return[f(.84+l+s*.12+c*.07),f(.86+l*.92+s*.06),f(.78+l*.86-s*.05+c*.09)]}_registerColliders(e){e.get(`physics`)?.addCollider?.(this.group,{type:`terrain`,static:!0,terrain:this})}_registerShots(e){let t=e.get(`capture`);if(!t)return;let n=(e,t,n=1.7)=>[e,this.heightAt(e,t)+n,t];t.registerShot(`terrain-vista`,{description:`Hilltop over the open country toward the bay, mid-morning.`,camera:{position:n(-60,-40,26),yaw:152,pitch:-9,fov:75},apply(e){e.state.worldTime=34200}}),t.registerShot(`terrain-road`,{description:`Standing on the road at eye height, looking along it.`,camera:{position:n(-140,150),yaw:128,pitch:-3,fov:75},apply(e){e.state.worldTime=37800}}),t.registerShot(`terrain-coast`,{description:`The Saltmarch shoreline at golden hour.`,camera:{position:n(430,520,6),yaw:40,pitch:-6,fov:75},apply(e){e.state.worldTime=64800}}),t.registerShot(`terrain-town-site`,{description:`The Millhaven plateau, before the town is built on it.`,camera:{position:n(-260,380,18),yaw:0,pitch:-7,fov:75},apply(e){e.state.worldTime=39600}})}update(e,t){if(!this._ready)return;let n=t.camera.position,r=t.get(`sky`)?.sunDirection,i=this._uniforms;if(r&&i){i.uSunDir.value.copy(r);let e=r.y;i.uSunShadow.value=e<=.02?0:e>=.16?1:(e-.02)/.14}for(let e of this.chunks){let t=e.centre.distanceTo(n),r=0,i=Math.max(0,t-v*.71);for(let e=0;e<S.length;e++)i>S[e]&&(r=e+1);r!==e.level&&(e.level=r,e.geom.setIndex(new s(e.lodIndex[r].index,1)))}}dispose(){for(let e of this.chunks)e.geom.dispose();for(let e of this._horizonTex??[])e.dispose();this._uniforms?.uSplat?.value?.dispose?.(),this._uniforms?.uRegion?.value?.dispose?.(),this.material?.dispose(),this.group?.parent?.remove(this.group),this.chunks.length=0}};export{N as TerrainSystem};