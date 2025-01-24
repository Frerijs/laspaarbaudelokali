// main.js

const csvInput = document.getElementById("csvFile");
const lasInput = document.getElementById("lasFile");
const processBtn = document.getElementById("processBtn");

const errorDiv = document.getElementById("error");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");

// ========= KONSTANTES / IESTATĪJUMI ===========
// Rādiuss - var pamēģināt 0.2, ja punkti tiešām ir tuvu
// Debug nolūkos var uzlikt 2.0, lai redzētu, vai vispār atrod.
const RADIUS = 0.2;

// Cik punktus apstrādā vienā chunk:
const CHUNK_SIZE = 200000;

// Cik Web Worker paralēli
let numWorkers = navigator.hardwareConcurrency || 4;

let csvPoints = [];
let bestDist = [];
let bestLASZ = [];

let lasFile;
let lasInfo; // satur {numPoints, pointDataOffset, pointRecordLen, scale, offset}
let chunkTasks = [];
let totalChunks = 0;
let chunksCompleted = 0;

// Worker pool
let workers = [];
let freeWorkers = [];

// ====================================================
// 1) CSV lasīšana ar Papa Parse
// ====================================================
async function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => {
        try {
          const data = results.data;
          const pts = data.map(row => {
            const keys = {};
            for (let k of Object.keys(row)) {
              keys[k.toLowerCase()] = row[k];
            }
            const X = parseFloat(keys['x']);
            const Y = parseFloat(keys['y']);
            const Z = parseFloat(keys['z']);
            return {x:X, y:Y, z:Z};
          }).filter(p => !isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z));
          resolve(pts);
        } catch (err) {
          reject(err);
        }
      },
      error: err => reject(err)
    });
  });
}

// ====================================================
// 2) Nolasa LAS faila galveni
// ====================================================
async function readLASHeader(file) {
  const headerSize = 375; // "drošības rezerve"
  const arrayBuf = await file.slice(0, headerSize).arrayBuffer();
  const dv = new DataView(arrayBuf);

  // Pārbaudām "LASF"
  const signature = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3)
  );
  if (signature !== "LASF") {
    throw new Error("Failā nav 'LASF' signatūra (vai tas nav .las?)");
  }

  const pointDataOffset = dv.getUint32(96, true);
  const numPoints = dv.getUint32(107, true);

  const scaleX = dv.getFloat64(131, true);
  const scaleY = dv.getFloat64(139, true);
  const scaleZ = dv.getFloat64(147, true);

  const offX = dv.getFloat64(155, true);
  const offY = dv.getFloat64(163, true);
  const offZ = dv.getFloat64(171, true);

  const format = dv.getUint8(104);
  if (![0,1,2,3].includes(format)) {
    throw new Error("Neparedzēts Point Data Format: " + format);
  }
  const recordLen = dv.getUint16(105, true);

  console.log("DEBUG: LAS Header =>",
    "numPoints=", numPoints,
    "offset=", pointDataOffset,
    "recordLen=", recordLen,
    "scale=", [scaleX,scaleY,scaleZ],
    "offsetXYZ=", [offX,offY,offZ]
  );

  return {
    numPoints,
    pointDataOffset,
    pointRecordLen: recordLen,
    scale: [scaleX, scaleY, scaleZ],
    offset: [offX, offY, offZ]
  };
}

// ====================================================
// 3) Izveido workeru baseinu
// ====================================================
function createWorkerPool(num) {
  workers = [];
  freeWorkers = [];
  for (let i=0; i<num; i++) {
    const w = new Worker('./worker.js');
    w.onmessage = evt => handleWorkerMessage(w, evt.data);
    workers.push(w);
    freeWorkers.push(w);
  }
}

// Kad worker pabeidz chunk
function handleWorkerMessage(worker, msg) {
  if (msg.type === 'chunkResult') {
    // Apvieno rezultātus
    for (const upd of msg.payload) {
      if (upd.dist < bestDist[upd.idx]) {
        bestDist[upd.idx] = upd.dist;
        bestLASZ[upd.idx] = upd.lasZ;
      }
    }
    chunksCompleted++;
    statusDiv.innerHTML = `Chunki: ${chunksCompleted} / ${totalChunks}`;
    freeWorkers.push(worker);

    // Mēģinām iedot nākamo chunk
    scheduleChunk();
  }
  else if (msg.type === 'done') {
    console.log("Worker pabeidza darbus:", worker);
  }
  else if (msg.type === 'log') {
    console.log("Worker LOG:", msg.payload);
  }
}

// ====================================================
// 4) "scheduleChunk" - piešķir chunk workerim
// ====================================================
async function scheduleChunk() {
  if (chunkTasks.length === 0) {
    // Vai visi chunki ir pabeigti?
    if (chunksCompleted === totalChunks) {
      finalizeResults();
    }
    return;
  }
  if (freeWorkers.length === 0) {
    // Nav brīvu workeru
    return;
  }

  const task = chunkTasks.shift(); // paņem pirmo chunk definīciju
  const worker = freeWorkers.pop();

  const {byteStart, byteLength, chunkPoints} = task;
  // Nolasām chunk par ArrayBuffer
  const blob = lasFile.slice(byteStart, byteStart + byteLength);
  console.log(`DEBUG: chunkPoints=${chunkPoints}, byteStart=${byteStart}, byteLength=${byteLength}, blob.size=${blob.size}`);
  // Ja "blob.size=0", tad netiks nolasīti punkti
  const arrayBuf = await blob.arrayBuffer();
  console.log("DEBUG: arrayBuf.byteLength=", arrayBuf.byteLength);

  worker.postMessage({
    type: 'processChunk',
    buffer: arrayBuf,
    chunkPoints,
    pointRecordLen: lasInfo.pointRecordLen,
    scale: lasInfo.scale,
    offset: lasInfo.offset,
    radius: RADIUS
  }, [arrayBuf]); // Transfer the buffer
}

// ====================================================
// 5) Kad visi chunki pabeigti
// ====================================================
function finalizeResults() {
  statusDiv.innerHTML = "Veido rezultātu...";

  let html = "<table><tr><th>CSV X</th><th>CSV Y</th><th>CSV Z</th><th>LAS Z</th><th>ΔZ</th><th>dist</th></tr>";
  for (let i=0; i<csvPoints.length; i++) {
    if (bestDist[i] < Infinity) {
      const dz = csvPoints[i].z - bestLASZ[i];
      html += `
        <tr>
          <td>${csvPoints[i].x.toFixed(3)}</td>
          <td>${csvPoints[i].y.toFixed(3)}</td>
          <td>${csvPoints[i].z.toFixed(3)}</td>
          <td>${bestLASZ[i].toFixed(3)}</td>
          <td>${dz.toFixed(3)}</td>
          <td>${bestDist[i].toFixed(3)}</td>
        </tr>`;
    } else {
      // Nav atrasts neviens <= RADIUS
      html += `
        <tr>
          <td>${csvPoints[i].x.toFixed(3)}</td>
          <td>${csvPoints[i].y.toFixed(3)}</td>
          <td>${csvPoints[i].z.toFixed(3)}</td>
          <td>-</td><td>-</td><td>-</td>
        </tr>`;
    }
  }
  html += "</table>";
  resultsDiv.innerHTML = html;

  statusDiv.innerHTML = "Gatavs!";

  // Brīvprātīgi var paziņot workerus noMoreChunks
  for (let w of workers) {
    w.postMessage({type:'noMoreChunks'});
  }
}

// ====================================================
// 6) Pogas notikums
// ====================================================
processBtn.addEventListener('click', async ()=> {
  errorDiv.textContent = "";
  resultsDiv.innerHTML = "";
  statusDiv.innerHTML = "";

  if (!csvInput.files.length || !lasInput.files.length) {
    errorDiv.textContent = "Lūdzu, atlasiet gan CSV, gan LAS failu!";
    return;
  }

  try {
    statusDiv.innerHTML = "Nolasa CSV...";
    csvPoints = await parseCSV(csvInput.files[0]);
    bestDist = new Array(csvPoints.length).fill(Infinity);
    bestLASZ = new Array(csvPoints.length).fill(null);

    // Nolasa LAS galveni
    statusDiv.innerHTML = "Nolasa LAS galveni...";
    lasFile = lasInput.files[0];
    lasInfo = await readLASHeader(lasFile);

    // Sagatavo chunk sarakstu
    chunkTasks = [];
    let pointsRemaining = lasInfo.numPoints;
    let currentByteOffset = lasInfo.pointDataOffset;
    let totalPointsRead = 0;

    while (pointsRemaining > 0) {
      const chunkPoints = Math.min(CHUNK_SIZE, pointsRemaining);
      const byteLen = chunkPoints * lasInfo.pointRecordLen;

      chunkTasks.push({
        chunkPoints,
        byteStart: currentByteOffset,
        byteLength: byteLen
      });

      currentByteOffset += byteLen;
      pointsRemaining -= chunkPoints;
      totalPointsRead += chunkPoints;
    }
    totalChunks = chunkTasks.length;
    chunksCompleted = 0;

    console.log("DEBUG: Kopējie chunki=", totalChunks);

    statusDiv.innerHTML = `Sagatavoti ${totalChunks} chunki.`;
    createWorkerPool(numWorkers);

    // (Ja vajag CSV worker pusē, var sūtīt "initCSV" tagad.)
    // for (let w of workers) {
    //   w.postMessage({ type:'initCSV', csvPoints, radius:RADIUS });
    // }

    // Uzsāk chunk scheduling
    for (let i=0; i<freeWorkers.length; i++) {
      scheduleChunk();
    }

  } catch (err) {
    console.error("Kļūda apstrādē:", err);
    errorDiv.textContent = "Kļūda: " + err.message;
  }
});
