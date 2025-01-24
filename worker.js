// worker.js

// Ja vajag "globālos" CSV/kdIndex:
let csvPoints = [];
let radius = 0.2;
// let kdIndex = null; // ja izmantojam kdbush, te saglabā

onmessage = async function(evt) {
  const msg = evt.data;

  if (msg.type === 'initCSV') {
    // Ja vēlaties CSV glabāt workerī
    csvPoints = msg.csvPoints;
    radius = msg.radius;
    // te var izveidot kdIndex: kdIndex = kdbush(...);
    // ...
  }
  else if (msg.type === 'processChunk') {
    // Tagad tieši saņemam ArrayBuffer
    const buffer = msg.buffer; 
    const dv = new DataView(buffer);

    const chunkPoints = msg.chunkPoints;
    const recordLen = msg.pointRecordLen;
    const [sx, sy, sz] = msg.scale;
    const [ox, oy, oz] = msg.offset;
    const rad = msg.radius || 0.2;

    let updates = [];
    let off = 0;

    for (let i=0; i<chunkPoints; i++) {
      const Xint = dv.getInt32(off + 0, true);
      const Yint = dv.getInt32(off + 4, true);
      const Zint = dv.getInt32(off + 8, true);
      off += recordLen;

      const X = Xint*sx + ox;
      const Y = Yint*sy + oy;
      const Z = Zint*sz + oz;

      // DEMO: nav reāla k-d tree meklēšana
      // Naivi: CSV pusē O(M). Reālajā risinājumā:
      //   - kdIndex.range(X-rad, Y-rad, X+rad, Y+rad) => candidateIndices
      //   - un tad aprēķināt attālumu <= rad
      if (csvPoints.length) {
        for (let c=0; c<csvPoints.length; c++) {
          const dx = csvPoints[c].x - X;
          const dy = csvPoints[c].y - Y;
          const dist2 = dx*dx + dy*dy;
          if (dist2 <= rad*rad) {
            const dist = Math.sqrt(dist2);
            updates.push({ idx:c, dist, lasZ:Z });
          }
        }
      }
    }

    postMessage({type:'chunkResult', payload: updates});
  }
  else if (msg.type === 'noMoreChunks') {
    postMessage({type:'done'});
  }
};
