import{St as e,a as t,i as n,n as r,o as i,r as a,t as o}from"./three-Bd1PvSFC.js";import{t as s}from"./index-BotfF7-v.js";var c={low:{bloom:!1,smaa:!1,scale:1},medium:{bloom:!1,smaa:!1,scale:1,strength:.22},high:{bloom:!1,smaa:!0,scale:1,strength:.28},ultra:{bloom:!1,smaa:!0,scale:1,strength:.32}},l={uniforms:{tDiffuse:{value:null},uTime:{value:0},uVignette:{value:.05},uGrain:{value:0},uWarmth:{value:.055},uContrast:{value:1},uSaturation:{value:1.05},uUnderwater:{value:0},uDamage:{value:0}},vertexShader:`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uWarmth, uContrast, uSaturation;
    uniform float uUnderwater, uDamage;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // Underwater: shift toward blue-green and lose the reds.
      if (uUnderwater > 0.001) {
        vec3 water = vec3(c.r * 0.42, c.g * 0.78, c.b * 1.06);
        c = mix(c, water, uUnderwater);
      }

      // Warmth: lift red, trim blue. Sunlight, not a sepia filter.
      c.r += uWarmth * c.r;
      c.b -= uWarmth * 0.55 * c.b;

      // Contrast about mid grey, so highlights do not clip.
      c = (c - 0.5) * uContrast + 0.5;

      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);

      // Damage flash reddens the frame edges rather than the whole image.
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 0.75, distance(vUv, vec2(0.5)));
        c = mix(c, vec3(0.55, 0.04, 0.03), edge * uDamage * 0.75);
      }

      // Vignette, gentle enough to read as a lens rather than a mask.
      float d = distance(vUv, vec2(0.5)) * 1.414;
      c *= 1.0 - uVignette * d * d;

      // Film grain, scaled by darkness — grain in the highlights looks wrong.
      float g = hash(vUv * 1024.0 + fract(uTime) * 137.0) - 0.5;
      c += g * uGrain * (1.0 - luma * 0.7);

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `},u=class extends s{static id=`postfx`;static order=400;constructor(){super(),this.composer=null,this.smaa=!1,this.enabled=!0,this._damage=0}async init(s){let u=c[s.config.quality]??c.high;this.q=u;let d=s.renderer,f=d.getSize(new e);this.composer=new t(d),this.composer.setSize(f.x,f.y),this.composer.setPixelRatio(d.getPixelRatio()),this.composer.addPass(new n(s.scene,s.camera)),(u.bloom||s.config.bloom)&&(this.bloom=new a(new e(f.x,f.y),u.strength??.3,.55,.86),this.composer.addPass(this.bloom)),this.grade=new i(l),this.composer.addPass(this.grade),this.composer.addPass(new r),s.get(`sky`)?.setPreTonemap?.(!0),u.smaa&&s.config.postAA!==`off`&&(this.composer.addPass(new o(f.x,f.y)),this.smaa=!0),s.engine.renderPipeline={render:e=>{if(!this.enabled){s.renderer.render(s.scene,s.camera);return}this.composer.render(e)}},s.events.on(`combat:hit`,e=>{e?.party&&(this._damage=Math.min(1,this._damage+.55))}),this._registerShots(s)}update(e,t){if(!this.grade)return;let n=this.grade.uniforms;n.uTime.value=t.state.elapsed,this._damage*=Math.max(0,1-e*2.6),n.uDamage.value=this._damage;let r=t.get(`water`)?.level,i=+(r!==void 0&&t.camera.position.y<r);n.uUnderwater.value+=(i-n.uUnderwater.value)*Math.min(1,e*6);let a=!!t.get(`dungeon`)?.current,o=a?.12:.05,s=a?.015:.055;if(n.uVignette.value+=(o-n.uVignette.value)*Math.min(1,e*2),n.uWarmth.value+=(s-n.uWarmth.value)*Math.min(1,e*2),this.bloom){let t=a?(this.q.strength??.3)*1.9:this.q.strength??.3;this.bloom.strength+=(t-this.bloom.strength)*Math.min(1,e*2)}}resize(e,t){this.composer?.setSize(e,t),this.bloom?.setSize(e,t)}_registerShots(e){e.get(`capture`)?.registerShot(`postfx-off`,{description:`The same frame with post-processing disabled, for comparison.`,apply:e=>{this.enabled=!1;let t=e.get(`terrain`);t&&(e.camera.position.set(-60,t.heightAt(-60,-40)+26,-40),e.camera.rotation.set(-.16,152*Math.PI/180,0,`YXZ`),e.get(`player`)?.syncFromCamera?.(e.camera)),e.state.worldTime=34200}})}dispose(){this.composer?.dispose?.()}};export{u as PostFXSystem};