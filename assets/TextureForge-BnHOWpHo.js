import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{Ct as t,H as n,J as r,Q as i,St as a,Tt as o,U as s,Y as c,g as l,h as u,lt as d,m as f,ot as p,st as m,ut as h,wt as g,xt as _}from"./three-Bd1PvSFC.js";import{t as v}from"./noise.glsl-DqBNb-tO.js";var y=e({TextureForge:()=>w,default:()=>w}),b=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,x=`
precision highp float;
precision highp int;
varying vec2 vUv;
uniform vec2  uResolution;
uniform vec2  uTexel;
uniform float uSeed;
`,S=`
uniform sampler2D uHeight;
uniform float uPacked;
float H(vec2 uv) {
  vec4 t = texture2D(uHeight, fract(uv));
  return mix(t.r, unpackH16(t.rg), uPacked);
}
`,C=0,w=class{constructor(e,t={}){this.renderer=e,this.maxAnisotropy=Math.min(t.anisotropy??16,e?.capabilities?.getMaxAnisotropy?.()??1),this._scene=new d,this._camera=new l;let n=new u;n.setAttribute(`position`,new f(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),n.setAttribute(`uv`,new f(new Float32Array([0,0,2,0,0,2]),2)),this._geometry=n,this._mesh=new r(n,new c),this._mesh.frustumCulled=!1,this._scene.add(this._mesh),this._cache=new Map,this._targets=new Set,this._targetOf=new WeakMap,this._disposed=!1,this.bakedTexels=0,this.bakeCount=0,this.bakeMs=0}static isSoftwareRenderer(e){try{let t=e.getContext(),n=t.getExtension(`WEBGL_debug_renderer_info`),r=n?String(t.getParameter(n.UNMASKED_RENDERER_WEBGL)):``;return/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(r)}catch{return!1}}bake(e,t={}){let{width:r=1024,height:a=r,uniforms:c={},defines:l={},colorSpace:u=``,wrap:d=m,generateMipmaps:f=!0,format:g=p,type:y=_,key:S=null,noise:w=!0,anisotropy:T=this.maxAnisotropy,linearFilter:E=!0}=t;if(S&&this._cache.has(S))return this._cache.get(S);if(this._disposed)throw Error(`[TextureForge] used after dispose()`);let D=typeof performance<`u`?performance.now():0,O=new o(r,a,{format:g,type:y,colorSpace:u,wrapS:d,wrapT:d,magFilter:E?n:i,minFilter:f?s:E?n:i,generateMipmaps:f,anisotropy:T,depthBuffer:!1,stencilBuffer:!1});O.texture.name=S??`forge-${C++}`,this._targets.add(O);let k=new h({vertexShader:b,fragmentShader:(w?v:``)+`
`+e,uniforms:this._wrapUniforms(c,r,a),defines:{...l},depthTest:!1,depthWrite:!1,blending:0,transparent:!1,side:2});k.fragmentShader=x+k.fragmentShader;let A=this.renderer.getRenderTarget();this._mesh.material=k;try{this.renderer.setRenderTarget(O),this.renderer.render(this._scene,this._camera)}finally{this.renderer.setRenderTarget(A),this._mesh.material=null,k.dispose()}let j=O.texture;return j.wrapS=d,j.wrapT=d,j.anisotropy=T,j.needsUpdate=!1,this._targetOf.set(j,O),S&&this._cache.set(S,j),this.bakeCount++,this.bakedTexels+=r*a,this.bakeMs+=(typeof performance<`u`?performance.now():0)-D,j}heightToNormal(e,t=.05,n={}){let r=n.width??e.image?.width??1024,i=n.height??e.image?.height??r;return this.bake(`
      ${S}
      uniform float uStrength;
      void main() {
        vec2 e = uTexel;
        float tl = H(vUv + vec2(-e.x,  e.y));
        float t  = H(vUv + vec2( 0.0,  e.y));
        float tr = H(vUv + vec2( e.x,  e.y));
        float l  = H(vUv + vec2(-e.x,  0.0));
        float r  = H(vUv + vec2( e.x,  0.0));
        float bl = H(vUv + vec2(-e.x, -e.y));
        float b  = H(vUv + vec2( 0.0, -e.y));
        float br = H(vUv + vec2( e.x, -e.y));

        // Sobel gradients, normalised into true dH/du and dH/dv.
        float dHdu = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / (8.0 * e.x);
        float dHdv = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / (8.0 * e.y);

        vec3 n = normalize(vec3(-dHdu * uStrength, -dHdv * uStrength, 1.0));
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }
    `,{width:r,height:i,uniforms:{uHeight:e,uPacked:n.packed===!1?0:1,uStrength:t},colorSpace:``,generateMipmaps:n.generateMipmaps??!0,key:n.key})}heightToAO(e,t={}){let n=t.width??e.image?.width??1024,r=t.height??e.image?.height??n,i=Math.max(4,Math.min(32,Math.round(t.samples??16)));return this.bake(`
      ${S}
      uniform float uRadius;
      uniform float uAmplitude;
      uniform float uStrength;
      const int SAMPLES = ${i};
      void main() {
        float h0 = H(vUv);
        float occNear = 0.0;
        float occFar = 0.0;
        float wsum = 0.0;
        // Golden-angle spiral: even coverage without a texture lookup table.
        for (int i = 0; i < SAMPLES; i++) {
          float fi = (float(i) + 0.5) / float(SAMPLES);
          float ang = float(i) * 2.39996323 + hash12(vUv * 512.0) * 6.2831853;
          float rad = uRadius * sqrt(fi);
          vec2 off = vec2(cos(ang), sin(ang)) * rad;
          float hs = H(vUv + off);
          float diff = (hs - h0) * uAmplitude;
          float horizon = clamp(diff / max(rad, 1e-4), 0.0, 1.0);
          float w = 1.0 - fi * 0.4;
          occNear += horizon * w;
          // Second, wider ring for broad cavity shading.
          float hs2 = H(vUv + off * 3.0);
          occFar += clamp((hs2 - h0) * uAmplitude / max(rad * 3.0, 1e-4), 0.0, 1.0) * w;
          wsum += w;
        }
        occNear /= max(wsum, 1e-4);
        occFar /= max(wsum, 1e-4);
        float ao = clamp(1.0 - occNear * uStrength, 0.0, 1.0);
        float aoFar = clamp(1.0 - occFar * uStrength * 0.85, 0.0, 1.0);
        ao = pow(ao, 1.15);
        gl_FragColor = vec4(ao, aoFar, 1.0 - ao, 1.0);
      }
    `,{width:n,height:r,uniforms:{uHeight:e,uPacked:t.packed===!1?0:1,uRadius:t.radius??.02,uAmplitude:t.amplitude??.35,uStrength:t.strength??1},colorSpace:``,generateMipmaps:t.generateMipmaps??!0,key:t.key})}heightToCurvature(e,t={}){let n=t.width??e.image?.width??1024,r=t.height??e.image?.height??n;return this.bake(`
      ${S}
      uniform float uScale;
      void main() {
        vec2 e = uTexel * uScale;
        float h0 = H(vUv);
        float acc = 0.0;
        acc += H(vUv + vec2( e.x, 0.0));
        acc += H(vUv + vec2(-e.x, 0.0));
        acc += H(vUv + vec2(0.0,  e.y));
        acc += H(vUv + vec2(0.0, -e.y));
        acc += H(vUv + vec2( e.x,  e.y)) * 0.7071;
        acc += H(vUv + vec2(-e.x,  e.y)) * 0.7071;
        acc += H(vUv + vec2( e.x, -e.y)) * 0.7071;
        acc += H(vUv + vec2(-e.x, -e.y)) * 0.7071;
        float avg = acc / (4.0 + 4.0 * 0.7071);
        float curv = (h0 - avg) * 24.0;
        float signed_ = clamp(curv * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(signed_, clamp(curv, 0.0, 1.0), clamp(-curv, 0.0, 1.0), 1.0);
      }
    `,{width:n,height:r,uniforms:{uHeight:e,uPacked:t.packed===!1?0:1,uScale:t.scale??2},colorSpace:``,generateMipmaps:t.generateMipmaps??!0,key:t.key})}unpackHeight(e,t={}){let n=t.width??e.image?.width??1024,r=t.height??e.image?.height??n;return this.bake(`
      ${S}
      void main() {
        float h = H(vUv);
        gl_FragColor = vec4(vec3(h), 1.0);
      }
    `,{width:n,height:r,uniforms:{uHeight:e,uPacked:t.packed===!1?0:1},colorSpace:``,generateMipmaps:t.generateMipmaps??!0,key:t.key})}release(e){let t=this._targetOf.get(e);t&&this._targets.has(t)&&(this._targets.delete(t),this._targetOf.delete(e),t.dispose());for(let[t,n]of this._cache)n===e&&this._cache.delete(t)}dispose(){if(!this._disposed){this._disposed=!0;for(let e of this._targets)e.dispose();this._targets.clear(),this._cache.clear(),this._geometry.dispose(),this._scene.remove(this._mesh),this._mesh.material=null}}_wrapUniforms(e,t,n){let r={uResolution:{value:new a(t,n)},uTexel:{value:new a(1/t,1/n)},uSeed:{value:0}};for(let[t,n]of Object.entries(e))r[t]={value:this._coerce(n)};return r}_coerce(e){if(Array.isArray(e)){if(e.length===2)return new a(e[0],e[1]);if(e.length===3)return new t(e[0],e[1],e[2]);if(e.length===4)return new g(e[0],e[1],e[2],e[3])}return typeof e==`boolean`?+!!e:e}};export{y as n,w as t};