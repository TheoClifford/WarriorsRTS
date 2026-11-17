import { render, rotZ, transform, Sprite } from '../src/render/rt';
import { catModel, PELTS, Pose } from '../src/render/models';
import { writeFileSync } from 'fs';
const types = ['apprentice','warrior','guard','runner','stalker','leader','fox'];
const facings = [0,1,3,4,5];
const poses: [string, Pose][] = [['idle',{sit:true}],['walk0',{walk:0}],['walk1',{walk:0.25}],['atk',{lunge:1,paw:1}],['gather',{crouch:0.6,headDown:1}],['pounce',{pounce:true}],['fall',{fall:1}],['carry',{walk:0.5,carry:'prey'}]];
const W=84,H=72;
const sheets: Sprite[][] = [];
for (const t of types) {
  const row: Sprite[] = [];
  const clan = t==='fox'||t==='badger'?'thunder':['thunder','river','wind','shadow'][types.indexOf(t)%4];
  const pelt = t==='fox'? require('../src/render/models').FOX_PELT : t==='badger'? require('../src/render/models').BADGER_PELT : PELTS[clan][types.indexOf(t)%6];
  for (const f of facings) row.push(render(transform(catModel(t, pelt, {sit:true}), rotZ(f*Math.PI/4)), {w:W,h:H,ax:42,ay:54,outline:1, toModel: rotZ(-f*Math.PI/4)}));
  for (const [,p] of poses.slice(1)) row.push(render(transform(catModel(t, pelt, p), rotZ(0)), {w:W,h:H,ax:42,ay:54,outline:1, toModel: rotZ(0)}));
  sheets.push(row);
}
const cols = sheets[0].length, SW = cols*W, SH = sheets.length*H;
const buf = Buffer.alloc(SW*SH*4);
for (let i=0;i<SW*SH;i++){buf[i*4]=104;buf[i*4+1]=150;buf[i*4+2]=66;buf[i*4+3]=255;}
sheets.forEach((row,r)=>row.forEach((s,c)=>{ for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=(y*W+x)*4; const a=s.data[k+3]/255; if(!a)continue; const o=((r*H+y)*SW+c*W+x)*4; for(let j=0;j<3;j++) buf[o+j]=buf[o+j]*(1-a)+s.data[k+j]*a; }}));
writeFileSync('test/out/sheet.rgba', buf); writeFileSync('test/out/sheet.json', JSON.stringify({w:SW,h:SH}));
