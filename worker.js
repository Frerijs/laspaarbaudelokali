// worker.js

// Ja vajag CSV pusē, definējiet globālus mainīgos:
let csvPoints = [];
let radius = 0.2;

onmessage = async function(evt) {
  const msg = evt.data;

  if (msg.type === 'initCSV') {
    // Ja sūtāt CSV no galvenā pavediena
    csvPoints = msg.csvPoints;
    radius = msg.radius || 0.2;
    postMessage({type:'log', payload:`Worker saņēma ${csvPoints.length} CSV punktus, radius=${radius}`});
  }
  else if (msg.type === 'processChunk') {
    // Saņemam chunk buffer
    const buffer = msg.buffer; // jau ArrayBuffer
    const dv = new DataView(buffer);

    const chunkPoints = msg.chunkPoints;
    const recordLen = msg.pointRecordLen;
    const [sx, sy, sz] = msg.scale;
    const [ox, oy, oz] = msg.offset;
    const rad = msg.radius || 0.2;

    postMessage({
      type:'log',
      payload:`Worker apstrādā chunk: chunkPoints=${chunkPoints}, bufferSize=${buffer.byteLength}`
    });

    // DEMO meklēšana: O(M) CSV, nav k-d tree
    let updates = [];
    let off = 0;

    // Izdrukāsim dažus pirmos LAS punktus (debug)
    const debugCount = 5; // cik punktus parādīsim
    for (let i=0; i<chunkPoints; i++) {
      const Xint = dv.getInt32(off, true);
      const Yint = dv.getInt32(off+4, true);
      const Zint = dv.getInt32(off+8, true);
      off += recordLen;

      const X = Xint*sx + ox;
      const Y = Yint*sy + oy;
      const Z = Zint*sz + oz;

      // Debug: parādām tikai pirmos "debugCount" punktus
      if (i < debugCount) {
        postMessage({type:'log', payload:`LAS i=${i}: X=${X}, Y=${Y}, Z=${Z}`});
      }

      // Pārbaudām CSV pusē
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

    postMessage({type:'chunkResult', payload: updates});
  }
  else if (msg.type === 'noMoreChunks') {
    postMessage({type:'done'});
  }
};
