// Map check: verifies the fairness rules from spec section 9.
import { buildMap, toGlobal, HOME } from '../src/sim/map';
import { Pathfinder } from '../src/sim/path';
import { CLANS, MAPN, T_OPEN,T_UNDER,T_MOOR,T_MARSH,T_ROAD,T_FLAT,T_TUNNEL,T_FORD,T_RIVER } from '../src/sim/core';
const m = buildMap(); const N = MAPN;
function pass(swim=false, frozen=false){ const a=new Uint8Array(N*N); for(let i=0;i<N*N;i++){const t=m.terrain[i]; let c=0; if([T_OPEN,T_MOOR,T_ROAD,T_FLAT,T_TUNNEL].includes(t))c=100; else if(t===T_UNDER)c=111; else if(t===T_MARSH)c=118; else if(t===T_FORD)c=143; else if(t===T_RIVER)c=frozen?105:swim?143:0; a[i]=c;} 
  // camps & nurseries block
  for (const k in m.camps){const c=m.camps[k]; for(let y=c.ty-2;y<=c.ty+2;y++)for(let x=c.tx-2;x<=c.tx+2;x++)a[y*N+x]=0;}
  return a; }
const pf = new Pathfinder();
function pathLen(p: Uint8Array, a:[number,number], b:[number,number]) { const r = pf.find(p, a[0],a[1],b[0],b[1], 100000); if(!r.reached) return -1; let len=0, px=a[0],py=a[1]; for (const t of r.tiles){const x=t%N,y=(t/N)|0; len += (x!==px&&y!==py)?1.414:1; px=x;py=y;} return len; }
const exitOf = (c:string)=>{ const q=CLANS.indexOf(c as any); return toGlobal(q, 18, 18) as [number,number]; };
const P = pass();
let ok = true; const lens: number[] = [];
console.log('Walking distance between camps (normal walker, river not frozen):');
for (let i=0;i<4;i++) for (let j=i+1;j<4;j++) {
  const L = pathLen(P, exitOf(CLANS[i]), exitOf(CLANS[j])); lens.push(L);
  console.log(`  ${CLANS[i].padEnd(8)} - ${CLANS[j].padEnd(8)} ${L.toFixed(1)}`);
}
const mx=Math.max(...lens), mn=Math.min(...lens);
console.log(`  spread: ${((mx-mn)/mx*100).toFixed(1)}% (rule: within 5%)`); if ((mx-mn)/mx > 0.05) ok=false;
// every resource reachable from its home camp; starter grounds within 8 tiles
for (const r of m.resources) {
  if (r.sub==='fish') continue;
  const home = r.home!==undefined && r.home<4 ? CLANS[r.home] : 'thunder';
  const L = pathLen(P, exitOf(home), [r.tx, r.ty]);
  if (L<0) { console.log('UNREACHABLE resource', r.sub, r.tx, r.ty); ok=false; }
}
for (let q=0;q<4;q++){ const c=toGlobal(q,HOME.camp[0],HOME.camp[1]); for(const s of HOME.starter){const g=toGlobal(q,s[0],s[1]); const d=Math.hypot(g[0]-c[0],g[1]-c[1]); if(d>8.0001){console.log('starter too far',d);ok=false;}}}
// totals per home
const tot: any = {}; for (const r of m.resources) { if (r.home===undefined||r.home>3) continue; const k=CLANS[r.home]; tot[k]=tot[k]||{prey:0,moss:0,herbs:0,grounds:0}; if(r.cap<99999){tot[k][r.rt]+=r.stock;} if(r.sub==='ground'||r.sub==='carrion')tot[k].grounds++; }
console.log('Home totals:', JSON.stringify(tot));
// approaches: count army-wide (>=3 tiles) openings through each camp ring by flood from camp with ring tiles
console.log(ok ? 'MAP CHECK PASSED' : 'MAP CHECK FAILED');
process.exit(ok?0:1);
