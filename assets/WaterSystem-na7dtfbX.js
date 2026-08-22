import{Ct as e,J as t,N as n,Tt as r,bt as i,l as a,nt as o,rt as s,ut as c,x as l}from"./three-Bd1PvSFC.js";import{t as u}from"./index-BotfF7-v.js";import{WORLD_SIZE as d}from"./TerrainGen-DtBCP4t7.js";var f=new l(3115188),p=new l(734544),m=new l(14676214),h=class extends u{static id=`water`;static order=60;constructor(){super(),this.mesh=null,this.level=0,this._reflect=null,this._reflectCam=null,this._enabled=!0,this._halfRate=!1,this._frame=0}async init(e){let i=e.get(`terrain`);this.terrain=i??null;let a=e.config.quality;if(a===`ultra`||a===`high`){let t=a===`ultra`?512:256;this._reflect=new r(t,t,{type:n,depthBuffer:!0,generateMipmaps:!1}),this._reflectCam=new o,this._halfRate=e.config.pixelRatioCap<=1.5||typeof window<`u`&&!!window.matchMedia?.(`(pointer: coarse)`)?.matches}this.material=this._buildMaterial(e);let c=new s(d*1.5,d*1.5,96,96);c.rotateX(-Math.PI/2),this.mesh=new t(c,this.material),this.mesh.position.y=this.level,this.mesh.renderOrder=1,this.mesh.receiveShadow=!1,this.mesh.frustumCulled=!1,this.mesh.name=`water`,e.scene.add(this.mesh),this._registerShots(e)}levelAt(e,t){return this.terrain?this.terrain.heightAt(e,t)<this.level?this.level:null:this.level}isWater(e,t){return this.levelAt(e,t)!==null}waterDepthAt(e,t){let n=this.levelAt(e,t);return n===null?0:n-(this.terrain?.heightAt?.(e,t)??n)}_buildMaterial(t){let n={uTime:{value:0},uShallow:{value:f.clone()},uDeep:{value:p.clone()},uFoam:{value:m.clone()},uSunDir:{value:new e(.4,.6,.3)},uSunColor:{value:new l(16773336)},uSkyColor:{value:new l(2704780)},uReflect:{value:this._reflect?this._reflect.texture:null},uHasReflect:{value:+!!this._reflect},uCamPos:{value:new e},uDepthTex:{value:null}};this._uniforms=n;let r=Object.assign(i.clone(a.fog),n);return new c({uniforms:r,transparent:!0,depthWrite:!1,side:2,fog:!0,vertexShader:`
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform float uTime;

        // Two crossing gerstner-ish swells. Cheap, and enough to catch a
        // highlight and give the horizon a little life.
        float swell(vec2 p, vec2 dir, float freq, float speed) {
          return sin(dot(p, dir) * freq + uTime * speed);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          vec2 p = (modelMatrix * vec4(position, 1.0)).xz;
          pos.y += swell(p, normalize(vec2(1.0, 0.35)), 0.055, 0.9) * 0.16;
          pos.y += swell(p, normalize(vec2(-0.4, 1.0)), 0.085, 1.3) * 0.09;
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,fragmentShader:`
        #include <fog_pars_fragment>
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSkyColor, uCamPos;
        uniform sampler2D uReflect;
        uniform float uHasReflect;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }

        void main() {
          vec2 p = vWorld.xz;

          // Ripple normal from two scrolling octaves plus a fine detail layer.
          float e = 0.6;
          vec2 f1 = p * 0.12 + vec2(uTime * 0.05, uTime * 0.03);
          vec2 f2 = p * 0.31 - vec2(uTime * 0.08, uTime * 0.06);
          float h  = fbm(f1) * 0.6 + fbm(f2) * 0.4;
          float hx = fbm(f1 + vec2(e, 0.0)) * 0.6 + fbm(f2 + vec2(e, 0.0)) * 0.4;
          float hz = fbm(f1 + vec2(0.0, e)) * 0.6 + fbm(f2 + vec2(0.0, e)) * 0.4;
          vec3 n = normalize(vec3((h - hx) * 2.2, 1.0, (h - hz) * 2.2));

          vec3 viewDir = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
          fres = mix(0.04, 1.0, fres);

          // Body colour deepens with distance from the shoreline. Without a
          // depth texture, view angle is a decent proxy: grazing views look
          // through more water.
          float graze = 1.0 - clamp(dot(n, viewDir), 0.0, 1.0);
          vec3 body = mix(uShallow, uDeep, clamp(graze * 1.35, 0.0, 1.0));

          vec3 refl = uSkyColor;
          if (uHasReflect > 0.5) {
            vec2 ruv = gl_FragCoord.xy / vec2(textureSize(uReflect, 0));
            refl = mix(uSkyColor, texture2D(uReflect, ruv + n.xz * 0.03).rgb, 0.75);
          }

          vec3 col = mix(body, refl, fres * 0.82);

          // Sun glint: a tight specular lobe on the ripple normals.
          vec3 hv = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, hv), 0.0), 220.0);
          col += uSunColor * spec * 1.9;

          // Chop crests catch a little foam.
          float crest = smoothstep(0.62, 0.78, h);
          col = mix(col, uFoam, crest * 0.16);

          gl_FragColor = vec4(col, 0.90);
          #include <fog_fragment>
        }
      `})}update(e,t){if(!this.mesh)return;let n=this._uniforms;n.uTime.value=t.state.elapsed,n.uCamPos.value.copy(t.camera.position);let r=t.get(`sky`);r&&(r.sunDirection&&n.uSunDir.value.copy(r.sunDirection),r.sunColor&&n.uSunColor.value.copy(r.sunColor),r.fogColor&&n.uSkyColor.value.copy(r.fogColor)),this.mesh.position.x=t.camera.position.x,this.mesh.position.z=t.camera.position.z,this._frame=(this._frame??0)+1,this._reflect&&(!this._halfRate||!(this._frame&1))&&this._renderReflection(t)}_renderReflection(e){let t=e.camera;if(t.position.y<this.level+.2||e.get(`dungeon`)?.current)return;let n=e.renderer,r=n.shadowMap.autoUpdate;n.shadowMap.autoUpdate=!1;let i=this._reflectCam;i.copy(t),i.position.y=2*this.level-t.position.y,i.rotation.set(-t.rotation.x,t.rotation.y,-t.rotation.z,`YXZ`),i.updateMatrixWorld(!0),i.updateProjectionMatrix(),this.mesh.visible=!1;let a=n.getRenderTarget();n.setRenderTarget(this._reflect),n.clear(),n.render(e.scene,i),n.setRenderTarget(a),this.mesh.visible=!0,n.shadowMap.autoUpdate=r}_aimYaw(e){let t=this._shoreAim??{x:e.x,z:e.z+60};return Math.atan2(-(t.x-e.x),-(t.z-e.z))*180/Math.PI}_registerShots(e){let t=e.get(`capture`),n=e.get(`terrain`);if(!t)return;let r={x:430,z:520};if(n){let e=n.worldSize/2-40,t=-1;for(let i=-e;i<=e;i+=32)for(let a=-e;a<=e;a+=32){let e=n.heightAt(a,i);if(e<this.level+.6||e>this.level+4)continue;let o=0;for(let e=0;e<8;e++){let t=e/8*Math.PI*2;for(let e=20;e<=120;e+=20)n.heightAt(a+Math.sin(t)*e,i+Math.cos(t)*e)<this.level&&o++}o>t&&(t=o,r={x:a,z:i})}let i={x:r.x,z:r.z+60},a=1/0;for(let e=0;e<16;e++){let t=e/16*Math.PI*2,o=r.x+Math.sin(t)*90,s=r.z+Math.cos(t)*90,c=n.heightAt(o,s);c<a&&(a=c,i={x:o,z:s})}this._shoreAim=i}let i=(e,t)=>(n?.heightAt?.(e,t)??0)+1.7;t.registerShot(`water-shore`,{description:`Standing on the shoreline looking out to sea at golden hour.`,camera:{position:[r.x,Math.max(this.level+1.8,i(r.x,r.z)),r.z],yaw:this._aimYaw(r),pitch:-4,fov:75},apply(e){e.state.worldTime=65520,e.events.emit(`weather:force`,{kind:`clear`})}}),t.registerShot(`water-noon`,{description:`The bay at midday, sun glinting off the chop.`,camera:{position:[r.x,Math.max(this.level+2.4,i(r.x,r.z)+.7),r.z],yaw:this._aimYaw(r),pitch:-6,fov:75},apply(e){e.state.worldTime=43200,e.events.emit(`weather:force`,{kind:`clear`})}})}dispose(){this.mesh?.geometry?.dispose(),this.material?.dispose(),this._reflect?.dispose(),this.mesh?.parent?.remove(this.mesh)}};export{h as WaterSystem};