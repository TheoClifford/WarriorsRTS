import { render, Sprite } from '../src/render/rt';
import { treeModel, rockModel, fernModel, structureModel, monsterModel, critterModel, snowify } from '../src/render/models';
import { writeFileSync } from 'fs';
const items: [string, Sprite][] = [];
const R = (prims:any, w:number, h:number, ax:number, ay:number) => render(prims, {w,h,ax,ay,outline:1});
for (const st of [0,1,2,3,4]) for (const s of [1,2,3]) items.push(['tree', R(treeModel(st, s, 3), 150, 170, 75, 140)]);
items.push(['rock', R(rockModel(1,false,1),150,170,75,140)]); items.push(['cliff', R(rockModel(2,true,1),150,170,75,140)]);
for (const k of ['fern','reed','heather','gorse'] as const) items.push([k, R(fernModel(1,1,k),150,170,75,140)]);
const c: any = [232,98,46];
for (const t of ['camp','nursery','den','cache','hollow','marker','medden','elders','barrier','gorse','tunnel','fence','moss','herb','catmint']) items.push([t, R(structureModel(t, c, 1), t==='camp'?340:200, t==='camp'?240:170, t==='camp'?170:100, t==='camp'?160:120)]);
items.push(['campsnow', R(snowify(structureModel('camp', c, 1)), 340, 240, 170, 160)]);
items.push(['monster', R(monsterModel(0), 150,170,75,140)]);
for (const k of ['mouse','rabbit','frog','rat']) items.push([k, R(critterModel(k,0), 40,40,20,30)]);
// pack into rows
const SW = 1400; let x=0,y=0,rowH=0; const pos: number[][] = [];
for (const [,s] of items){ if (x+s.w>SW){x=0;y+=rowH;rowH=0;} pos.push([x,y]); x+=s.w; rowH=Math.max(rowH,s.h); }
const SH=y+rowH; const buf=Buffer.alloc(SW*SH*4);
for (let i=0;i<SW*SH;i++){buf[i*4]=104;buf[i*4+1]=150;buf[i*4+2]=66;buf[i*4+3]=255;}
items.forEach(([,s],i)=>{const [ox,oy]=pos[i]; for(let yy=0;yy<s.h;yy++)for(let xx=0;xx<s.w;xx++){const k=(yy*s.w+xx)*4;const a=s.data[k+3]/255;if(!a)continue;const o=((oy+yy)*SW+ox+xx)*4;for(let j=0;j<3;j++)buf[o+j]=buf[o+j]*(1-a)+s.data[k+j]*a;}});
writeFileSync('test/out/sheet2.rgba',buf); writeFileSync('test/out/sheet2.json',JSON.stringify({w:SW,h:SH}));
