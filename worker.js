// worker.js

// Šeit “globals” puses workerim
let csvPoints = [];
let radius = 0.2;

// Pagaidām - nav reāla k-d tree implementācija, bet skices vieta
// Jums jāievieto bibliotēka (piem., kdbush) un reāli jāuzbūvē kdIndex no csvPoints.
let kdIndex = null;

onmessage = function(evt) {
  const msg = evt.data;

  if (msg.type === 'initCSV') {
    csvPoints = msg.csvPoints;
    radius = msg.radius || 0.2;
    // Te varētu izveidot k-d tree no CSV
    // Piemēram, ja izmanto kdbush:
    // kdIndex = kdbush(csvPoints, p => p.x, p => p.y, ...);

    // Pagaidām tikai parādam:
    postMessage({type:'log', payload:`Saņēmu CSV punktus: ${csvPoints.length}`});
  }
  else if (msg.type === 'processChunk') {
    // Saņemam chunk buffer
    const arrayBuf = msg.buffer;
    const dv = new DataView(arrayBuf);

    const chunkPoints = msg.chunkPoints;
    const recordLen = msg.pointRecordLen;
    const [sx, sy, sz] = msg.scale;
    const [ox, oy, oz] = msg.offset;

    let chunkUpdates = [];

    // Pagaidām “naiva” meklēšana CSV k-d tree:
    //   (ar kdbush var meklēt range “ap LIS punktu”, bet šeit DEMO)
    //   (Te atkal redzam: meklēt "kuram CSV punktam" var būt grūti.)
    //   (Varbūt reālajā dzīvē meklējam, kuri CSV punkti atrodas radius laukā.)
    //   (Nepilnība: CSV => k-d tree => range(LAS_X, LAS_Y, radius))

    let byteOff = 0;
    for (let i=0; i<chunkPoints; i++) {
      const Xint = dv.getInt32(byteOff + 0, true);
      const Yint = dv.getInt32(byteOff + 4, true);
      const Zint = dv.getInt32(byteOff + 8, true);
      byteOff += recordLen;

      const X = Xint*sx + ox;
      const Y = Yint*sy + oy;
      const Z = Zint*sz + oz;

      // DEMO: meklēsim, kuri CSV punkti atrodas <= radius
      // (Naivi: O(M). Reālajā dzīvē - kdIndex.range(...)!)
      for (let c=0; c<csvPoints.length; c++) {
        const dx = csvPoints[c].x - X;
        const dy = csvPoints[c].y - Y;
        const dist2d = Math.sqrt(dx*dx + dy*dy);
        if (dist2d <= radius) {
          // Mums vajag atgriezt “labāko” dist???
          // Bet, no LAS viedokļa, mums nav “labākais” - var būt vairāki punkti.
          // Tomēr, lai 1) atgrieztu info: {idx, dist, lasZ}
          // un galvenais pavediens izlems, vai labāks.

          chunkUpdates.push({
            idx: c,
            dist: dist2d,
            lasZ: Z
          });
        }
      }
    }

    // Atgriežam starprezultātus
    postMessage({
      type:'chunkResult',
      payload: chunkUpdates
    });
  }
  else if (msg.type === 'noMoreChunks') {
    // Viss pabeigts
    postMessage({type:'done'});
  }
};

