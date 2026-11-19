import * as T from 'three';
// Camera-local weather: original procedural effects, no navigation or forecast meaning.
export function createAlpineWeather(scene,{reduced=false,mobile=false}={}){
 const root=new T.Group();scene.add(root);
 const snowCanvas=document.createElement('canvas');snowCanvas.width=snowCanvas.height=32;
 const ctx=snowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(16,16,0,16,16,16);
 gradient.addColorStop(0,'rgba(230,244,255,.9)');gradient.addColorStop(.2,'rgba(215,236,250,.65)');gradient.addColorStop(1,'rgba(215,236,250,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);
 const texture=new T.CanvasTexture(snowCanvas),count=mobile?1200:3200;
 let seed=347;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const positions=new Float32Array(count*3),speeds=new Float32Array(count);
 for(let i=0;i<count;i++){positions[i*3]=(random()-.5)*52;positions[i*3+1]=random()*26-7;positions[i*3+2]=(random()-.5)*52;speeds[i]=.4+random();}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));
 const snow=new T.Points(geometry,new T.PointsMaterial({map:texture,color:'#dceaf2',size:.085,opacity:.83,transparent:true,depthWrite:false}));root.add(snow);snow.frustumCulled=false;
 const streakCount=mobile?170:480,streakPositions=new Float32Array(streakCount*6),streakGeometry=new T.BufferGeometry();streakGeometry.setAttribute('position',new T.BufferAttribute(streakPositions,3));
 const streaks=new T.LineSegments(streakGeometry,new T.LineBasicMaterial({color:'#d6e4ee',transparent:true,opacity:.33,depthWrite:false}));streaks.frustumCulled=false;root.add(streaks);
 const wisps=[];
 const valleyWispCount=mobile?5:9;
 for(let i=0;i<valleyWispCount+2;i++){
  const material=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{time:{value:0},phase:{value:i*2.13}},vertexShader:'varying vec2 uvW;void main(){uvW=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 uvW;uniform float time;uniform float phase;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 void main(){vec2 p=uvW;float edge=pow(max(0.,1.-abs(p.x*2.-1.)),1.4)*pow(max(0.,1.-abs(p.y*2.-1.)),2.);float plume=smoothstep(.25,.78,noise(p*vec2(6.,3.)+vec2(-time*.35+phase,phase))*.7+noise(p*vec2(16.,7.)+vec2(-time*.6,phase))*.3);float gust=.65+.35*pow(.5+.5*sin(time*.83+phase),2.);gl_FragColor=vec4(.66,.75,.81,edge*plume*.38*gust);}`});
  const near=i>=valleyWispCount,j=i-valleyWispCount;
  const wisp=new T.Mesh(new T.PlaneGeometry(near?17:55+i*12,near?1.6:9+i*1.8),material);wisp.position.set(near?4:30+i*19,near?1.4+j*.9:-14-i*6,near?14+j*17:65+i*30);scene.add(wisp);wisps.push(wisp);
 }
 const skyMaterial=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{time:{value:0}},vertexShader:'varying vec3 world;void main(){world=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
 varying vec3 world;uniform float time;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(3.7,9.2);a*=.5;}return v;}
 void main(){vec3 n=normalize(world);float h=max(0.,n.y);vec3 col=mix(vec3(.49,.60,.69),vec3(.12,.22,.32),pow(h,.5));vec2 uv=n.xz/(max(n.y,.06)+.25)*2.8;float c=fbm(uv+vec2(time*.014,0.));float detail=fbm(uv*3.8);float mask=smoothstep(.26,.69,c+detail*.12);vec3 cloud=mix(vec3(.22,.31,.40),vec3(.59,.68,.75),smoothstep(.35,.66,c));col=mix(col,cloud,mask*.88*smoothstep(-.04,.13,n.y));float alignment=max(dot(n,normalize(vec3(.65,.20,.75))),0.);col=mix(col,vec3(.80,.86,.89),pow(alignment,25.)*.20);gl_FragColor=vec4(col,1.);}`});
 const sky=new T.Mesh(new T.SphereGeometry(14300,32,24),skyMaterial);sky.renderOrder=-9;scene.add(sky);
 return {update(dt,camera,time){root.position.copy(camera.position);sky.position.copy(camera.position);skyMaterial.uniforms.time.value=time;const strength=Math.pow(.5+.5*Math.sin(time*.83),3);if(scene.fog)scene.fog.density=.00057+strength*.00021;for(const w of wisps){w.quaternion.copy(camera.quaternion);w.material.uniforms.time.value=time;}if(!reduced){const gust=6+8*strength;for(let i=0;i<count;i++){positions[i*3]+=dt*(gust+speeds[i]*2);positions[i*3+1]-=dt*speeds[i]*2.1;positions[i*3+2]+=dt*.8;if(positions[i*3]>26)positions[i*3]=-26;if(positions[i*3+1]<-7)positions[i*3+1]=19;if(positions[i*3+2]>26)positions[i*3+2]=-26;}geometry.attributes.position.needsUpdate=true;}
 for(let i=0;i<streakCount;i++){const p=i*3,k=i*6;streakPositions[k]=positions[p];streakPositions[k+1]=positions[p+1];streakPositions[k+2]=positions[p+2];streakPositions[k+3]=positions[p]-(.46+speeds[i]*.18)*(1+strength*.6);streakPositions[k+4]=positions[p+1]+.14;streakPositions[k+5]=positions[p+2]-.035;}streakGeometry.attributes.position.needsUpdate=true;},count,streakCount};
}
