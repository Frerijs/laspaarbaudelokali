// worker.js

let csvPoints = [];
let radius = 0.2;

// onmessage
onmessage = async function(evt) {
  const msg = evt.data;

  if (msg.type === 'processChunk') {
    // Saņem chunk definīciju
    const fileSlice = msg.fileSlice; // tas ir Blob
    const chunkPoints = msg.chunkPoints;
    const recordLen = msg.pointRecordLen;
    const [sx, sy, sz] = msg.scale;
    const [ox, oy, oz] = msg.offset;
    const rad = msg.radius || 0.2;

    // Nolasa buffer:
    const buffer = await fileSlice.arrayBuffer();
    const dv = new DataView(buffer);

    // Rezultāta masīvs
    const updates = [];

    // DEMO: nav reāla k-d tree, bet joprojām naivs meklējums CSV
    let off = 0;
    for (let i=0; i<chunkPoints; i++) {
      const Xint = dv.getInt32(off + 0, true);
      const Yint = dv.getInt32(off + 4, true);
      const Zint = dv.getInt32(off + 8, true);
      off += recordLen;

      const X = Xint*sx + ox;
      const Y = Yint*sy + oy;
      const Z = Zint*sz + oz;

      // Te jālieto kdIndex, bet DEMO - naivs loop:
      for (let c=0; c<csvPoints.length; c++) {
        const dx = csvPoints[c].x - X;
        const dy = csvPoints[c].y - Y;
        const dist2d = Math.sqrt(dx*dx + dy*dy);
        if (dist2d <= rad) {
          updates.push({
            idx: c,
            dist: dist2d,
            lasZ: Z
          });
        }
      }
    }

    postMessage({type:'chunkResult', payload:updates});
  }
  else if (msg.type === 'initCSV') {
    csvPoints = msg.csvPoints;
    radius = msg.radius;
    // te varētu izveidot kdIndex no csvPoints
  }
  else if (msg.type === 'noMoreChunks') {
    postMessage({type:'done'});
  }
};
