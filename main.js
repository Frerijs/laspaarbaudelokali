// main.js

const csvInput = document.getElementById("csvFile");
const lasInput = document.getElementById("lasFile");
const processBtn = document.getElementById("processBtn");

const errorDiv = document.getElementById("error");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");

const RADIUS = 0.2;        // 20cm meklēšanas rādiuss
const CHUNK_SIZE = 200000; // punktu skaits katrā chunk
let numWorkers = navigator.hardwareConcurrency || 4; // cik CPU kodoli

// Glabāsim CSV, rezultātus un info
let csvPoints = [];
let bestDist = [];
let bestLASZ = [];

let lasFile;      // .las fails
let lasInfo;      // {numPoints, pointDataOffset, pointRecordLen, scale, offset}
let chunkTasks = [];     // masīvs ar chunk definīcijām
let totalChunks = 0;
let chunksCompleted = 0;

// Worker pool
let workers = [];
let freeWorkers = [];

// ===========================
// 1) CSV lasīšana (PapaParse)
// ===========================
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
            return {x: X, y: Y, z: Z};
          }).filter(p => !isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z));
          resolve(pts);
        } catch (err) { reject(err); }
      },
      error: err => reject(err)
    });
  });
}

// ===========================
// 2) LAS galvenes nolasīšana
// ===========================
async function readLASHeader(file) {
  const headerSize = 375;
  const ab = await file.slice(0, headerSize).arrayBuffer();
  const dv = new DataView(ab);

  // Pārbaudām "LASF"
  const signature = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3)
  );
  if (signature !== "LASF") {
    throw new Error("Nav 'LASF' signatūra. Vai tiešām LAS fails?");
  }

  const pointDataOffset = dv.getUint32(96, true);
  const numPoints = dv.getUint32(107, true);
  const scaleX = dv.getFloat64(131, true);
  const scaleY = dv.getFloat64(139, true);
  const scaleZ = dv.getFloat64(147, true);
  const offX = dv.getFloat64(155, true);
  const offY = dv.getFloat64(163, true);
  const offZ = dv.getFloat64(171, true);

  const pointFormat = dv.getUint8(104);
  if (![0,1,2,3].includes(pointFormat)) {
    throw new Error("Neparedzēts Point Data Format: " + pointFormat);
  }
  const pointRecordLen = dv.getUint16(105, true);

  return {
    numPoints,
    pointDataOffset,
    pointRecordLen,
    scale: [scaleX, scaleY, scaleZ],
    offset: [offX, offY, offZ]
  };
}

// ===========================
// 3) Izveido workeru baseinu
// ===========================
function createWorkerPool(num) {
  workers = [];
  freeWorkers = [];
  for (let i = 0; i < num; i++) {
    const w = new Worker('./worker.js');
    w.onmessage = evt => handleWorkerMessage(w, evt.data);
    workers.push(w);
    freeWorkers.push(w);
  }
}

// ===========================
// 4) Apstrāde, kad worker pabeidz chunk
// ===========================
function handleWorkerMessage(worker, msg) {
  if (msg.type === 'chunkResult') {
    // msg.payload = masīvs {idx, dist, lasZ}
    for (const upd of msg.payload) {
      if (upd.dist < bestDist[upd.idx]) {
        bestDist[upd.idx] = upd.dist;
        bestLASZ[upd.idx] = upd.lasZ;
      }
    }
    chunksCompleted++;
    statusDiv.innerHTML = `Chunki: ${chunksCompleted}/${totalChunks}`;
    freeWorkers.push(worker); // worker atkal ir brīvs
    scheduleChunk(); // mēģinām iedot nākamo chunk
  }
  else if (msg.type === 'done') {
    // Worker pabeidzis
  }
  else if (msg.type === 'log') {
    console.log("Worker log:", msg.payload);
  }
}

// ===========================
// 5) Uzdevumu (chunk) sadale
// ===========================
async function scheduleChunk() {
  if (chunkTasks.length === 0) {
    // Varbūt jau visi chunk pabeigti?
    if (chunksCompleted === totalChunks) {
      finalizeResults();
    }
    return;
  }
  if (freeWorkers.length === 0) {
    // nav brīvu workeru
    return;
  }

  // Izvelkam vienu chunk
  const task = chunkTasks.shift();
  const worker = freeWorkers.pop();

  // 1) Nolasām chunk par arrayBuffer jau šeit (lai “transferētu” tieši)
  const {byteStart, byteLength, chunkPoints} = task;
  const blob = lasFile.slice(byteStart, byteStart + byteLength);
  const ab = await blob.arrayBuffer();

  worker.postMessage({
    type: 'processChunk',
    buffer: ab,
    chunkPoints,
    pointRecordLen: lasInfo.pointRecordLen,
    scale: lasInfo.scale,
    offset: lasInfo.offset,
    radius: RADIUS
  }, [ab]); // transfer arrayBuffer
}

// ===========================
// 6) Kad apstrāde pabeigta
// ===========================
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
  // Lūdzu, var sūtīt "noMoreChunks" workeriem, ja gribat
  for (let w of workers) {
    w.postMessage({type:'noMoreChunks'});
  }
}

// ===========================
// 7) Pogas notikums
// ===========================
processBtn.addEventListener('click', async ()=> {
  errorDiv.textContent = "";
  resultsDiv.innerHTML = "";
  statusDiv.innerHTML = "";

  if (!csvInput.files.length || !lasInput.files.length) {
    errorDiv.textContent = "Lūdzu, atlasiet gan CSV, gan LAS failu!";
    return;
  }

  try {
    // 1) Nolasa CSV
    statusDiv.innerHTML = "Nolasa CSV...";
    csvPoints = await parseCSV(csvInput.files[0]);
    // Iniciē "bestDist", "bestLASZ"
    bestDist = new Array(csvPoints.length).fill(Infinity);
    bestLASZ = new Array(csvPoints.length).fill(null);

    // *Šeit* var izveidot k-d tree no CSV, un varbūt saglabāt to
    // par Worker pusei (ar initCSV). Attiecīgi worker.js jāpārveido.
    // Piemērs: kdIndex = kdbush(csvPoints, p=>p.x, p=>p.y, ...);

    // 2) Nolasa LAS galveni
    statusDiv.innerHTML = "Nolasa LAS galveni...";
    lasFile = lasInput.files[0];
    lasInfo = await readLASHeader(lasFile);

    // 3) Sagatavo chunk sarakstu
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

    statusDiv.innerHTML = `Sagatavoti ${totalChunks} chunki.`;

    // 4) Izveido workeru pool
    createWorkerPool(numWorkers);

    // 5) Var sūtīt "initCSV" workerim, ja vajag
    //    (Šeit atstājam brīvu. Ja gribat sūtīt CSV punktus, dari:)
    // for (let w of workers) {
    //   w.postMessage({ type:'initCSV', csvPoints, radius:RADIUS });
    // }

    // 6) Startē chunk scheduling
    for (let i=0; i<freeWorkers.length; i++) {
      scheduleChunk();
    }

  } catch (err) {
    console.error(err);
    errorDiv.textContent = "Kļūda: " + err.message;
  }
});
