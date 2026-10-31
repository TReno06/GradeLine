// Elevation color ramp (hypsometric tint) — PLAN.md Stage 2 checkpoint 3
// port, extracted verbatim from main.js.
var rampStops = [
  {t:0.00, c:[46, 92, 158]},
  {t:0.35, c:[63, 150, 124]},
  {t:0.60, c:[176, 186, 73]},
  {t:0.82, c:[200, 142, 58]},
  {t:1.00, c:[176, 58, 46]}
];

export function rampColor(t: number): number[] {
  t = Math.max(0, Math.min(1, t));
  for (var i=0;i<rampStops.length-1;i++){
    var s0 = rampStops[i], s1 = rampStops[i+1];
    if (t >= s0.t && t <= s1.t){
      var f = (s1.t===s0.t) ? 0 : (t-s0.t)/(s1.t-s0.t);
      return [
        s0.c[0] + (s1.c[0]-s0.c[0])*f,
        s0.c[1] + (s1.c[1]-s0.c[1])*f,
        s0.c[2] + (s1.c[2]-s0.c[2])*f
      ];
    }
  }
  return rampStops[rampStops.length-1].c;
}

export function rampCSSGradient(){
  var parts = rampStops.map(function(s){
    return 'rgb('+s.c[0]+','+s.c[1]+','+s.c[2]+') '+(s.t*100)+'%';
  });
  return 'linear-gradient(to right, '+parts.join(', ')+')';
}
