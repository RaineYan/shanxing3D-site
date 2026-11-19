import * as T from 'three';
import {GLTFLoader} from '../vendor/three/addons/loaders/GLTFLoader.js';
import {unifySurface} from './continuous-surface.mjs';
import {createAlpineWeather} from './alpine-weather.mjs';
import {createContinuousTerrain,center,ground,LENGTH} from './continuous-terrain.mjs';
const $=id=>document.getElementById(id),root=$('scene'),canvas=$('world'),reduce=matchMedia('(prefers-reduced-motion:reduce)'),params=new URLSearchParams(location.search);
const fixed=params.has('frame')?Math.max(0,Math.min(1,Number(params.get('frame'))||0)):null;
if(params.get('capture')==='poster')document.body.classList.add('capture');
let renderer,scene,camera,terrain,weather,model,route,ready=false,paused=reduce.matches||fixed!==null,progress=fixed??(reduce.matches?1:0),last=0,raf=0,quality='auto',time=0,loops=0;
let distance=params.has('distance')?Math.max(0,Math.min(100000,Number(params.get('distance'))||0)):(fixed??(reduce.matches?1:0))*20;const travel={value:distance};
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v)),smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
function updatePose(){
 if(!camera)return;
 const phase=distance%LENGTH,x=center(phase),g=ground(phase),bob=.012*Math.sin(distance/1.35*Math.PI*2);
 camera.position.set(x,g+1.65+bob,0);
 const turn=Math.atan2(center(phase+7)-x,7);
 const tilt=-.045+Math.atan2(ground(phase+5)-g,5)*.3;
 camera.lookAt(x+Math.sin(turn)*Math.cos(tilt),camera.position.y+Math.sin(tilt),Math.cos(turn)*Math.cos(tilt));
 camera.fov=camera.aspect<.85?65:58;camera.updateProjectionMatrix();
 terrain.update(distance);travel.value=distance;progress=phase/LENGTH;loops=Math.floor(distance/LENGTH);
 root.dataset.distance=distance.toFixed(5);root.dataset.origin='floating';
 const reveal=1;root.style.setProperty('--reveal',String(reveal));root.style.setProperty('--route-opacity','0');$('bar').style.width=progress*100+'%';root.dataset.progress=progress.toFixed(4);root.dataset.eye=camera.position.toArray().map(v=>v.toFixed(3)).join(',');
 $('skip').hidden=true;$('replay').hidden=false;$('caption').textContent='循着雪路，一直向前。';$('phase').textContent='持续行走 · 可随时进入行程';root.dataset.loops=String(loops);root.dataset.transition='false';
 const hero=document.querySelector('.hero');hero.inert=reveal<.02;hero.setAttribute('aria-hidden',String(reveal<.02));
}
function draw(){renderer.render(scene,camera);root.dataset.triangles=String(renderer.info.render.triangles);}
function render(){if(!ready)return;weather.update(0,camera,time);draw();}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
function schedule(){if(ready&&!paused&&!document.hidden&&!raf)raf=requestAnimationFrame(tick);}
function tick(ms){raf=0;if(paused||document.hidden)return;const dt=last?Math.max(0,(ms-last)/1000):0;last=ms;time+=dt;distance+=Math.min(dt,.08)*1.25;updatePose();weather.update(Math.min(dt,.1),camera,time);draw();schedule();}
function pause(value){paused=value;stop();$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'继续动态':'暂停动态');$('pause').title=paused?'继续动态':'暂停动态';$('pause').setAttribute('aria-pressed',String(paused));render();schedule();}
function resize(){if(!renderer)return;const w=root.clientWidth,h=root.clientHeight,cap=quality==='high'?1700000:quality==='low'?400000:950000;renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6,Math.sqrt(cap/(w*h))));renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=w/h<.85?65:58;camera.updateProjectionMatrix();updatePose();render();}
function staticView(message){stop();ready=false;document.body.classList.add('static');$('status').textContent=message;root.dataset.state='static';document.querySelector('.hero').inert=false;document.querySelector('.hero').setAttribute('aria-hidden','false');for(const id of ['pause','skip','quality'])$(id).disabled=true;}
async function load(){try{
 if(params.get('renderer')==='static'){staticView('静态山境 · 可直接进入行程');return;}
 renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;
 scene=new T.Scene();scene.background=new T.Color('#647e94');scene.fog=new T.FogExp2('#91a9bb',.00057);scene.add(new T.HemisphereLight('#c3d7e8','#253442',1.1));const key=new T.DirectionalLight('#dce8f1',2.15);key.position.set(210,110,250);scene.add(key);const fill=new T.DirectionalLight('#8daec9',.65);fill.position.set(-110,90,-50);scene.add(fill);
 const [trail,background]=await Promise.all([new GLTFLoader().loadAsync('assets/walk-tile.glb'),new GLTFLoader().loadAsync('assets/walk-background.glb')]);
 route={nodes:Array.from({length:8},(_,i)=>[0,i,0])};model=trail.scene;
 unifySurface(model,route.nodes,travel);unifySurface(background.scene,route.nodes,{value:0});scene.add(background.scene);terrain=createContinuousTerrain(scene,model);
 camera=new T.PerspectiveCamera(58,1,.05,18000);weather=createAlpineWeather(scene,{reduced:reduce.matches,mobile:innerWidth<700});ready=true;resize();updatePose();render();document.body.classList.add('ready');root.dataset.state='ready';$('status').textContent='原创连续雪山 · AHOLO / BLENDER';pause(paused);
}catch(error){console.error(error);staticView('3D 暂不可用 · 可直接进入行程');}}
$('pause').onclick=()=>pause(!paused);$('skip').onclick=()=>{distance=20;updatePose();render();};$('replay').onclick=()=>{distance=0;time=0;updatePose();pause(false);};$('quality').onclick=()=>{quality=({auto:'low',low:'high',high:'auto'})[quality];$('quality').textContent='◉';$('quality').title='画质：'+({auto:'自动',low:'节能',high:'精细'})[quality];$('quality').setAttribute('aria-label',$('quality').title);resize();};
canvas.addEventListener('wheel',e=>{if(!ready)return;e.preventDefault();distance=Math.max(0,distance+e.deltaY*.012);updatePose();render();},{passive:false});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else schedule();});addEventListener('resize',resize);reduce.addEventListener('change',e=>{if(e.matches)distance=20;pause(e.matches);});canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();staticView('图形连接中断 · 已切换静帧');});
load();
