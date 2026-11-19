// Conservative 16-sided circumscribed elliptical cylinders. Cardinal face
// normals keep nominal box extents exact while enclosing the analytic cylinder.
// These proxies enclose the analytic cylinder; they never shrink equipment.
import {Vector3} from '../vendor/three/three.module.js';
const N=16, R=1/Math.cos(Math.PI/N);
export function convexProxy(asset, obb) {
  if(asset.collisionShape==='box')return {vertices:obb.corners,edges:obb.halfAxes,
    normals:[obb.halfAxes[1].clone().cross(obb.halfAxes[2]),obb.halfAxes[2].clone().cross(obb.halfAxes[0]),obb.halfAxes[0].clone().cross(obb.halfAxes[1])]};
  if(asset.collisionShape!=='cylinder')throw Error('invalid-proxy-shape');
  const axis=['x','y','z'].indexOf(asset.collisionAxis);
  if(axis<0)throw Error('invalid-proxy-axis');
  const radial=[0,1,2].filter(i=>i!==axis),a=obb.halfAxes[radial[0]],b=obb.halfAxes[radial[1]],h=obb.halfAxes[axis];
  const ring=Array.from({length:N},(_,i)=>a.clone().multiplyScalar(R*Math.cos((i+.5)*2*Math.PI/N)).addScaledVector(b,R*Math.sin((i+.5)*2*Math.PI/N)));
  const edges=ring.map((v,i)=>ring[(i+1)%N].clone().sub(v));
  return {vertices:[-1,1].flatMap(sign=>ring.map(v=>v.clone().add(obb.center).addScaledVector(h,sign))),
    edges:[h,...edges],normals:[a.clone().cross(b),...edges.map(edge=>edge.clone().cross(h))]};
}
export function intersectsConvex(a,b,epsilonM) {
  const axes=[];
  const add=v=>{const length=v.length();if(length<=1e-12)return;const n=v.clone().divideScalar(length);
    if(!axes.some(axis=>Math.abs(axis.dot(n))>1-1e-12))axes.push(n);};
  a.normals.forEach(add);b.normals.forEach(add);
  for(const x of a.edges)for(const y of b.edges)add(new Vector3().crossVectors(x,y));
  for(const axis of axes){
    const project=proxy=>{let min=Infinity,max=-Infinity;for(const v of proxy.vertices){const d=v.dot(axis);min=Math.min(min,d);max=Math.max(max,d);}return[min,max];};
    const x=project(a),y=project(b);
    if(Math.min(x[1]-y[0],y[1]-x[0])<=epsilonM)return false;
  }
  return true;
}
export function intersectsConfigured(a,obbA,b,obbB,epsilonM){
  // Box-box already passed the original exact OBB SAT. Older fixtures omit shape.
  if(a.collisionShape!=='cylinder'&&b.collisionShape!=='cylinder')return true;
  return intersectsConvex(convexProxy({...a,collisionShape:a.collisionShape??'box'},obbA),convexProxy({...b,collisionShape:b.collisionShape??'box'},obbB),epsilonM);
}
