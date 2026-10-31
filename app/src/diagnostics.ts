// Diagnostics — quick heuristics to flag likely survey/data problems
// without the user having to spot them in the 3D view themselves.
// PLAN.md Stage 2 checkpoint 3 port, extracted verbatim from main.js.
import { $ } from './dom.ts';
import { state } from './state.ts';
import type { Point3, Triangle, ComplianceRow } from './types.ts';

function detectClusters(points: Point3[], triangles: Triangle[]): {count: number; sizes: number[]} {
  if (!points.length) return {count:0, sizes:[]};
  if (!triangles.length) return {count:points.length, sizes:points.map(function(){return 1;})};

  var lengths: number[] = [];
  var edges: {a: number; b: number; len: number}[] = [];
  var seen: Record<string, boolean> = {};
  function edgeKeyOf(a: number, b: number){ return a<b ? a+'_'+b : b+'_'+a; }
  function addEdge(a: number, b: number){
    var key = edgeKeyOf(a,b);
    if (seen[key]) return;
    seen[key] = true;
    var dx = points[a].x-points[b].x, dy = points[a].y-points[b].y;
    var len = Math.sqrt(dx*dx+dy*dy);
    edges.push({a:a,b:b,len:len});
    lengths.push(len);
  }
  for (var t=0;t<triangles.length;t++){
    var tr = triangles[t];
    addEdge(tr[0],tr[1]); addEdge(tr[1],tr[2]); addEdge(tr[2],tr[0]);
  }
  lengths.sort(function(a,b){ return a-b; });
  var median = lengths[Math.floor(lengths.length/2)] || 1;
  var threshold = Math.max(median*15, 1e-6);

  var parent: number[] = new Array(points.length);
  for (var i=0;i<points.length;i++) parent[i] = i;
  function find(x: number): number { while(parent[x]!==x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; }
  function union(a: number, b: number){ var ra=find(a), rb=find(b); if (ra!==rb) parent[ra]=rb; }
  for (var e=0;e<edges.length;e++){
    if (edges[e].len <= threshold) union(edges[e].a, edges[e].b);
  }
  var groups: Record<number, number> = {};
  for (var p=0;p<points.length;p++){
    var r = find(p);
    groups[r] = (groups[r]||0)+1;
  }
  var sizes = Object.keys(groups).map(function(k){ return groups[Number(k)]; }).sort(function(a,b){ return b-a; });
  return {count: sizes.length, sizes: sizes};
}

// Approximate: points sharing the same X,Y to within 0.01 units count as
// near-duplicates. Grid-bucketed so it stays fast on large surveys.
function detectDuplicates(points: Point3[]): {count: number} {
  var cellSize = 0.01;
  var grid: Record<string, number> = {};
  var dupCount = 0;
  for (var i=0;i<points.length;i++){
    var p = points[i];
    var key = Math.round(p.x/cellSize) + '_' + Math.round(p.y/cellSize);
    if (grid[key]) dupCount++; else grid[key] = 0;
    grid[key]++;
  }
  return {count: dupCount};
}

// Flags triangle edges whose grade (rise:run) is far steeper than the
// surface's typical grade — often a mistyped Z, occasionally a real cliff
// or retaining wall the TIN can't represent well anyway.
function detectSteepTriangles(points: Point3[], triangles: Triangle[]): {count: number; worst: number} {
  if (!triangles.length) return {count:0, worst:0};
  var grades: number[] = [];
  for (var t=0;t<triangles.length;t++){
    var tri = triangles[t];
    var a=points[tri[0]], b=points[tri[1]], c=points[tri[2]];
    var pairs = [[a,b],[b,c],[c,a]];
    var maxG = 0;
    for (var e=0;e<3;e++){
      var p1=pairs[e][0], p2=pairs[e][1];
      var dx=p1.x-p2.x, dy=p1.y-p2.y;
      var dist = Math.sqrt(dx*dx+dy*dy);
      var dz = Math.abs(p1.z-p2.z);
      var grade = dist>1e-9 ? dz/dist : 0;
      if (grade>maxG) maxG = grade;
    }
    grades.push(maxG);
  }
  grades.sort(function(a,b){ return a-b; });
  var median = grades[Math.floor(grades.length/2)] || 0;
  var threshold = Math.max(median*8, 1.0);
  var count=0, worst=0;
  for (var i=0;i<grades.length;i++){
    if (grades[i] > threshold){ count++; if (grades[i]>worst) worst=grades[i]; }
  }
  return {count:count, worst:worst};
}

export function runDiagnostics(){
  if (!state.points.length || !state.triangles.length){
    $('section-diagnostics').style.display = 'none';
    $('diagnostics-body').innerHTML = '';
    return;
  }
  var clusters = detectClusters(state.points, state.triangles);
  var dups = detectDuplicates(state.points);
  var steep = detectSteepTriangles(state.points, state.triangles);

  var rows: ComplianceRow[] = [];
  if (clusters.count > 1){
    rows.push({cls:'diag-warn', text: clusters.count + ' disconnected point clusters detected (sizes: ' +
      clusters.sizes.slice(0,5).join(', ') + (clusters.sizes.length>5?', …':'') +
      '). The surface may be bridging unrelated groups of points — check for stray outliers or a coordinate mismatch.'});
  } else {
    rows.push({cls:'diag-ok', text: 'One continuous point cluster — no obvious gaps in the survey.'});
  }
  if (dups.count > 0){
    rows.push({cls:'diag-warn', text: dups.count + ' point' + (dups.count>1?'s':'') +
      ' nearly coincide in X,Y (within 0.01 units) with another point — possible duplicate shots.'});
  } else {
    rows.push({cls:'diag-ok', text: 'No near-duplicate points found.'});
  }
  if (steep.count > 0){
    rows.push({cls:'diag-warn', text: steep.count + ' triangle edge' + (steep.count>1?'s':'') +
      ' with an unusually steep grade (possible Z typo, or a genuine cliff/wall) — worst grade ' +
      steep.worst.toFixed(1) + ':1.'});
  } else {
    rows.push({cls:'diag-ok', text: 'No unusually steep triangle edges found.'});
  }

  var html = '';
  for (var i=0;i<rows.length;i++){
    html += '<div class="diag-row ' + rows[i].cls + '">' + rows[i].text + '</div>';
  }
  $('diagnostics-body').innerHTML = html;
  $('section-diagnostics').style.display = 'block';
}
