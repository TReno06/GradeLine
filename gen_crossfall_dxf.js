// Builds a minimal synthetic DXF with a survey point grid (a gentle
// cross-fall ramp: ground falls away to the "south" side) and TWO
// alignment polylines on a layer named "ALIGNMENT" a few metres apart,
// running roughly parallel — enough to exercise the crossfall view.
const fs = require('fs');

let lines = [];
function pair(code, val){ lines.push(String(code)); lines.push(String(val)); }

pair(0, 'SECTION');
pair(2, 'ENTITIES');

// Survey points: a 20x12 grid, x in [-5,55], y in [-5,15].
// z slopes down gently along x (long-section grade) and also falls off
// to higher y (so alignment A at y~0 and alignment B at y~6 read a real
// crossfall between them).
for (let i=0;i<=20;i++){
  const x = -5 + i*3;
  for (let j=0;j<=12;j++){
    const y = -5 + j*1.8;
    const z = 20.0 - x*0.02 - y*0.03;
    pair(0,'POINT');
    pair(8,'SURVEY');
    pair(10, x.toFixed(3));
    pair(20, y.toFixed(3));
    pair(30, z.toFixed(3));
  }
}

// Alignment A: straight line along y=0, x from 0 to 50.
pair(0,'LWPOLYLINE');
pair(8,'ALIGNMENT');
pair(90, 3);
pair(70, 0);
pair(38, 0);
[[0,0],[25,0],[50,0]].forEach(([x,y])=>{ pair(10,x.toFixed(2)); pair(20,y.toFixed(2)); });

// Alignment B: straight line along y=6, x from 0 to 50 (parallel, 6m away).
pair(0,'LWPOLYLINE');
pair(8,'ALIGNMENT');
pair(90, 3);
pair(70, 0);
pair(38, 0);
[[0,6],[25,6],[50,6]].forEach(([x,y])=>{ pair(10,x.toFixed(2)); pair(20,y.toFixed(2)); });

pair(0,'ENDSEC');
pair(0,'EOF');

fs.writeFileSync(__dirname + '/crossfall_fixture.dxf', lines.join('\n') + '\n');
console.log('wrote crossfall_fixture.dxf, lines:', lines.length);
