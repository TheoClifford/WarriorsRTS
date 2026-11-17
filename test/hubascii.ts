import { buildMap } from '../src/sim/map';
const m = buildMap(); const N = m.n;
const ch = '.,T~=w#R%F/t';  // OPEN UNDER TREES MOOR MARSH RIVER FORD ROAD ROCK FLAT FENCE TUNNEL
const [x0,y0,x1,y1] = process.argv.slice(2).map(Number);
for (let y=y0;y<=y1;y++){ let s=String(y).padStart(3)+' '; for(let x=x0;x<=x1;x++) s+=ch[m.terrain[y*N+x]]; console.log(s); }
