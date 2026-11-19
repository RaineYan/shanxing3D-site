import {Vector2} from 'three';
export function unifySurface(scene,nodes,travel={value:0}){scene.traverse(o=>{if(!o.isMesh||o.name.startsWith('Cliff_Ice_'))return;o.castShadow=false;const cliff=o.name.startsWith('Generated_Path_Cliff');for(const m of Array.isArray(o.material)?o.material:[o.material]){m.metalness=0;m.roughness=.92;m.map=null;if(!cliff)m.normalMap=null;else{m.normalScale?.set(.3,.3);m.aoMap=null;m.metalnessMap=null;m.roughnessMap=null;}m.onBeforeCompile=s=>{
s.uniforms.alpineTravel=travel;s.uniforms.trailNodes={value:nodes.map(n=>new Vector2(n[0],n[1]))};
s.vertexShader='uniform float alpineTravel;varying vec3 alpineWorld;varying vec3 alpineNormal;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nalpineWorld=(modelMatrix*vec4(transformed,1.)).xyz+vec3(0.,0.,alpineTravel);alpineNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
s.fragmentShader=`varying vec3 alpineWorld;varying vec3 alpineNormal;uniform vec2 trailNodes[8];uniform float alpineTravel;
float trailCenter(float d){float t=d/160.*6.28318530718;return 1.3*sin(t)+.28*sin(t*2.);}
float ah(vec3 p){return fract(sin(dot(p,vec3(12.989,78.233,37.719)))*43758.5453);}
float an(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(ah(i),ah(i+vec3(1,0,0)),f.x),mix(ah(i+vec3(0,1,0)),ah(i+vec3(1,1,0)),f.x),f.y),mix(mix(ah(i+vec3(0,0,1)),ah(i+vec3(1,0,1)),f.x),mix(ah(i+vec3(0,1,1)),ah(i+vec3(1,1,1)),f.x),f.y),f.z);}
`+s.fragmentShader;
s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float coarse=an(alpineWorld*.48);float dist=distance(alpineWorld,cameraPosition+vec3(0.,0.,alpineTravel));float fine=1.-smoothstep(8.,90.,dist);float grain=mix(an(alpineWorld*.11),an(alpineWorld*9.1)*.5+an(alpineWorld*29.3)*.24+an(alpineWorld*2.1)*.26,fine);
float bedding=mix(.65,pow(abs(sin(alpineWorld.y*5.8+alpineWorld.x*.7+coarse*3.)),.4),fine);
float strata=an(vec3(alpineWorld.x*.09,alpineWorld.y*.75+alpineWorld.x*.10,alpineWorld.z*.08));
float fissure=1.-smoothstep(.025,.095,abs(strata-.49));
vec3 stone=mix(vec3(.065,.09,.105),vec3(.30,.32,.31),grain*.58+bedding*.12+strata*.20);
stone*=1.-fissure*.16;
float altitude=smoothstep(180.,650.,alpineWorld.y)*.15;
float ledge=smoothstep(.63,.80,strata)*.15;
float cover=smoothstep(.58,.94,normalize(alpineNormal).y+(coarse-.5)*.16+altitude*.4+ledge*.5);
float wind=sin(alpineWorld.x*2.4+alpineWorld.z*.55+an(alpineWorld*.32)*2.);
float crust=pow(abs(wind),10.)*fine;
vec3 snow=mix(vec3(.55,.66,.73),vec3(.83,.89,.93),grain*.75+.13);
snow*=1.-crust*.085;
float windCut=pow(abs(sin(alpineWorld.x*5.2+alpineWorld.z*1.3+coarse*2.)),16.)*fine;
snow*=1.-windCut*.10;
// Long, shallow ice streaks give the basin a grounded flow direction.
float basin=(1.-smoothstep(-130.,-45.,alpineWorld.y))*smoothstep(.90,.99,normalize(alpineNormal).y);
float ice=pow(abs(sin(alpineWorld.x*.052+alpineWorld.z*.009+an(alpineWorld*.006)*3.)),18.);
snow=mix(snow,vec3(.43,.57,.65),basin*(.12+ice*.22));
diffuseColor.rgb=mix(stone,snow,cover);
float r=alpineWorld.x-trailCenter(alpineWorld.z);float path=(1.-smoothstep(.76,1.13,abs(r)))*smoothstep(.85,.95,normalize(alpineNormal).y);
vec2 footA=vec2((r+.22)/.065,(mod(alpineWorld.z,.72)-.36)/.14);vec2 footB=vec2((r-.22)/.065,(mod(alpineWorld.z+.36,.72)-.36)/.14);
float footprint=1.-smoothstep(.55,1.,min(dot(footA,footA),dot(footB,footB)));vec3 packed=snow*.91;packed=mix(packed,packed*.67,footprint*.65);diffuseColor.rgb=mix(diffuseColor.rgb,packed,path*.8);`);
s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
// Derivative bump follows real world scale, without changing the walkable mesh.
float relief=an(alpineWorld*vec3(1.8,7.,1.8))*.035+an(alpineWorld*14.)*.005;
vec3 qx=dFdx(alpineWorld),qy=dFdy(alpineWorld);
vec3 bx=cross(qy,normalize(alpineNormal)),by=cross(normalize(alpineNormal),qx);
float determinant=dot(qx,bx);
vec3 bump=(bx*dFdx(relief)+by*dFdy(relief))/max(abs(determinant),.00001);
normal=normalize(normal-mat3(viewMatrix)*(bump*.50));`);
s.fragmentShader=s.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
float valleyDistance=length(alpineWorld-cameraPosition-vec3(0.,0.,alpineTravel));
float lowMist=exp(-max(alpineWorld.y+95.,0.)*.012);
float aerial=(1.-exp(-valleyDistance*.00065))*lowMist;
vec3 sunward=normalize(vec3(.65,.20,.75));
float scattering=pow(max(dot(normalize(alpineWorld-cameraPosition-vec3(0.,0.,alpineTravel)),sunward),0.),8.);
gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(vec3(.51,.64,.75),vec3(.73,.81,.87),scattering*.35),aerial*.70);`);
};m.customProgramCacheKey=()=> 'continuous-coherent-rock-v2';m.needsUpdate=true;}});}
