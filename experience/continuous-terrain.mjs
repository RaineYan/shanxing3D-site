import * as T from 'three';
export const LENGTH=160;
export function center(d){const t=d/LENGTH*Math.PI*2;return 1.3*Math.sin(t)+.28*Math.sin(t*2);}
export function ground(d){const t=d/LENGTH*Math.PI*2;return .65*Math.sin(t)+.15*Math.sin(t*3);}
export function createContinuousTerrain(scene,source){
 const tiles=Array.from({length:5},()=>{const tile=source.clone(true);scene.add(tile);return tile;});
 return {update(distance){const base=Math.floor(distance/LENGTH);for(let i=-1;i<=3;i++){const index=base+i,slot=((index%5)+5)%5;tiles[slot].position.z=index*LENGTH-distance;}},tiles};
}
