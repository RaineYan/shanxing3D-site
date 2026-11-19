// Pure, convex, piecewise-linear height contour. One source for planes, mesh and volume.
const cache = new WeakMap();
export function compileInteriorProfile(profile) {
  if (cache.has(profile)) return cache.get(profile);
  const { sections, centerX = 0, chamferM: c } = profile ?? {};
  if (profile?.type !== 'convex-height-profile' || !Array.isArray(sections) || sections.length < 2 ||
      !Number.isFinite(centerX) || !Number.isFinite(c) || c <= 0) throw new Error('invalid-interior-profile');
  const vertices = [], triangles = [], planes = [];
  for (const [i, s] of sections.entries()) {
    if (![s.y,s.halfWidth,s.back,s.front].every(Number.isFinite) || s.halfWidth <= c || s.front-s.back <= 2*c ||
        (i && s.y <= sections[i-1].y)) throw new Error('invalid-interior-section');
    const l=centerX-s.halfWidth,r=centerX+s.halfWidth;
    for (const [x,z] of [[l,s.back+c],[l+c,s.back],[r-c,s.back],[r,s.back+c],[r,s.front-c],[r-c,s.front],[l+c,s.front],[l,s.front-c]]) vertices.push([x,s.y,z]);
  }
  const limits = s => [centerX+s.halfWidth,s.halfWidth-centerX,s.front,-s.back,
    centerX+s.halfWidth+s.front-c,s.halfWidth-centerX+s.front-c,
    centerX+s.halfWidth-s.back-c,s.halfWidth-centerX-s.back-c];
  const normals = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  let volumeM3 = 0;
  for(let i=0;i<sections.length-1;i++) {
    const a=sections[i],b=sections[i+1],h=b.y-a.y,lo=limits(a),hi=limits(b);
    for(let k=0;k<8;k++) {
      const slope=(hi[k]-lo[k])/h,[nx,nz]=normals[k],length=Math.hypot(nx,slope,nz);
      planes.push({normal:[nx/length,-slope/length,nz/length],limit:(lo[k]-slope*a.y)/length});
      const j=(k+1)%8,v=i*8+k,w=i*8+j;
      triangles.push([v,w,w+8],[v,w+8,v+8]);
    }
    const d=a.front-a.back,dd=b.front-b.back-d,dw=b.halfWidth-a.halfWidth;
    volumeM3+=h*(2*a.halfWidth*d+(2*a.halfWidth*dd+2*dw*d)/2+2*dw*dd/3-2*c*c);
  }
  planes.push({normal:[0,-1,0],limit:-sections[0].y},{normal:[0,1,0],limit:sections.at(-1).y});
  for(let i=1;i<7;i++) { triangles.push([0,i+1,i]); const top=(sections.length-1)*8;triangles.push([top,top+i,top+i+1]); }
  // Convexity is a verified invariant, not an assumption. It makes eight-corner OBB containment sufficient.
  if (!Number.isFinite(volumeM3) || volumeM3 <= 0 || vertices.some(v=>planes.some(p=>p.normal.reduce((s,n,i)=>s+n*v[i],0)>p.limit+1e-9))) throw new Error('non-convex-interior-profile');
  const min=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))),max=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
  const result={vertices,triangles,planes,volumeM3,min,max,sizeM:{x:max[0]-min[0],y:max[1]-min[1],z:max[2]-min[2]}};
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  freeze(result);
  if(Object.isFrozen(profile)) cache.set(profile,result);
  return result;
}
export function profileContainsCorners(profile, corners, localTolerance = [0,0,0]) {
  const {planes}=compileInteriorProfile(profile);
  return corners.every(v=>planes.every(p=>{
    const values=[v.x,v.y,v.z];
    const tolerance=p.normal.reduce((sum,n,i)=>sum+Math.abs(n)*localTolerance[i],0);
    return values.every(Number.isFinite)&&p.normal.reduce((sum,n,i)=>sum+n*values[i],0)<=p.limit+tolerance;
  }));
}
