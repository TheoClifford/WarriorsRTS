import { buildMap } from '../src/sim/map';
import { writeFileSync } from 'fs';
const m = buildMap();
const N = m.n, S = 6;
const col: Record<number, number[]> = {0:[110,160,70],1:[50,100,40],2:[20,60,20],3:[150,140,90],4:[90,100,70],5:[50,90,180],6:[120,170,200],7:[60,60,60],8:[130,130,130],9:[200,190,160],10:[180,120,60],11:[150,40,40]};
const px = Buffer.alloc(N*S*N*S*3);
for (let y=0;y<N*S;y++) for (let x=0;x<N*S;x++){ const t=m.terrain[((y/S)|0)*N+((x/S)|0)]; const c=col[t]; const i=(y*N*S+x)*3; px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2]; }
const dot=(tx:number,ty:number,c:number[],r=2)=>{for(let y=ty*S-r;y<=ty*S+S+r;y++)for(let x=tx*S-r;x<=tx*S+S+r;x++){if(x<0||y<0||x>=N*S||y>=N*S)continue;const i=(y*N*S+x)*3;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];}};
for (const r of m.resources) dot(r.tx,r.ty, r.rt==='prey'?[255,80,80]: r.rt==='moss'?[80,255,80]:[255,0,255],1);
for (const k in m.camps) { const c=m.camps[k]; for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++) dot(c.tx+a,c.ty+b,[255,255,255],0); }
for (const k in m.nursery) { const c=m.nursery[k]; dot(c.tx,c.ty,[255,200,0],3); }
for (const w of m.wild) dot(w.tx,w.ty,[255,128,0],2);
const hdr=Buffer.from(`P6 ${N*S} ${N*S} 255\n`);
writeFileSync('test/out/map.ppm', Buffer.concat([hdr,px]));
const counts:Record<number,number>={}; for(const t of m.terrain) counts[t]=(counts[t]||0)+1; console.log(counts);
