// main.js

const csvInput = document.getElementById("csvFile");
const lasInput = document.getElementById("lasFile");
const processBtn = document.getElementById("processBtn");

const errorDiv = document.getElementById("error");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");

// Konstantes
const RADIUS = 0.2;       // 20 cm
const CHUNK_SIZE = 200000; // cik LAS punktus vienā chunk
let numWorkers = navigator.hardwareConcurrency || 4; 
// varbūt lietot 4, 8, 16, atkarībā no CPU

// Globāli
let csvPoints = [];
let bestDist = [];
let bestLASZ = [];

let lasFile;
let lasInfo; // satur numPoints, pointDataOffset, pointRecordLen, scale, offset
let chunkTasks = [];  // chunku "rinda" (visas chunk definīcijas)
let totalChunks = 0;
let chunksCompleted = 0;

// Worker pool
let workers = [];
let freeWorkers = []; // kuri workers nav aizņemti

// ===========================
// 1) CSV lasīšana
// ===========================
async function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
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
      error: (err) => reject(err)
    });
  });
}

// ===========================
// 2) LAS galvenes lasīšana
// ===========================
async function readLASHeader(file) {
  const headerSize = 375;
  const ab = await file.slice(0, headerSize).arrayBuffer();
  const dv = new DataView(ab);

  const sig = String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3));
  if (sig !== "LASF") throw new Error("Trūkst 'LASF' signatūra!");

  const pointDataOffset = dv.getUint32(96, true);
  const numPoints = dv.getUint32(107, true);
  const sx = dv.getFloat64(131, true);
  const sy = dv.getFloat64(139, true);
  const sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true);
  const oy = dv.getFloat64(163, true);
  const oz = dv.getFloat64(171, true);

  const format = dv.getUint8(104);
  if (![0,1,2,3].includes(format)) {
    throw new Error("Neparedzēts Point Data Format: " + format);
  }
  const recordLen = dv.getUint16(105, true);

  return {
    numPoints,
    pointDataOffset,
    pointRecordLen: recordLen,
    scale: [sx, sy, sz],
    offset: [ox, oy, oz]
  };
}

// ===========================
// 3) K-d tree CSV pusē (ja vajag)
//     var kdbush = ...
// ===========================
// Demo: izlaidīsim reālo implementāciju, bet reālajā risinājumā
// te iebūvē kdbush no CSV punktiem un saglabā kdIndex.

// ===========================
// 4) sagatavo worker baseinu (pool)
// ===========================
function createWorkerPool(num) {
  workers = [];
  freeWorkers = [];
  for (let i=0; i<num; i++) {
    const w = new Worker('./worker.js');
    w.onmessage = (evt) => handleWorkerMessage(w, evt.data);
    workers.push(w);
    freeWorkers.push(w); // sākumā visi brīvi
  }
}

// ===========================
// 5) Kad worker pabeidz chunk, apstrādājam
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
    // chunk pabeigts -> chunkCompleted++
    chunksCompleted++;
    statusDiv.innerHTML = `Chunki: ${chunksCompleted} / ${totalChunks}`;
    // atbrīvojam worker
    freeWorkers.push(worker);
    // mēģinām iedot nākamo chunk
    scheduleChunk();
  }
  else if (msg.type === 'done') {
    // Worker paziņo, ka vairs nav chunku => ignorējam
  }
  else if (msg.type === 'log') {
    console.log("Worker log:", msg.payload);
  }
}

// ===========================
// 6) Uzdevumu (chunku) scheduling
// ===========================
function scheduleChunk() {
  if (chunkTasks.length === 0) {
    // Nav vairāk chunku rindā
    // Pārbaudām, vai visi chunki jau pabeigti?
    if (chunksCompleted === totalChunks) {
      // Done
      finalizeResults();
    }
    return;
  }
  if (freeWorkers.length === 0) {
    // Nav brīvu workeru
    return;
  }
  // Piešķiram vienu chunk
  const task = chunkTasks.shift();
  const worker = freeWorkers.pop();

  worker.postMessage({
    type: 'processChunk',
    chunkOffset: task.chunkOffset,
    chunkPoints: task.chunkPoints,
    pointRecordLen: lasInfo.pointRecordLen,
    scale: lasInfo.scale,
    offset: lasInfo.offset,
    radius: RADIUS,
    fileSlice: lasFile.slice(task.byteStart, task.byteStart + task.byteLength)
  });
}

// ===========================
// 7) Kad visi chunk apstrādāti, parādām rezultātu
// ===========================
function finalizeResults() {
  statusDiv.innerHTML = "Gatavs! Veido rezultātu...";
  let html = "<table><tr><th>CSV X</th><th>CSV Y</th><th>CSV Z</th><th>LAS Z</th><th>ΔZ</th><th>dist</th></tr>";
  for (let i=0; i<csvPoints.length; i++) {
    const dist = bestDist[i];
    if (dist < Infinity) {
      const dz = csvPoints[i].z - bestLASZ[i];
      html += `
        <tr>
          <td>${csvPoints[i].x.toFixed(3)}</td>
          <td>${csvPoints[i].y.toFixed(3)}</td>
          <td>${csvPoints[i].z.toFixed(3)}</td>
          <td>${bestLASZ[i].toFixed(3)}</td>
          <td>${dz.toFixed(3)}</td>
          <td>${dist.toFixed(3)}</td>
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
  statusDiv.innerHTML = "Rezultāts gatavs!";
  // beidzam
  // (var postMessage('done') katram workeram, lai tie noslēdz)
  for (let w of workers) {
    w.postMessage({type:'noMoreChunks'});
  }
}

// ===========================
// 8) Pogas klikšķa process
// ===========================
processBtn.addEventListener('click', async ()=> {
  errorDiv.textContent = "";
  resultsDiv.innerHTML = "";
  statusDiv.innerHTML = "";

  if (!csvInput.files.length || !lasInput.files.length) {
    errorDiv.textContent = "Atlasiet gan CSV, gan LAS failu!";
    return;
  }
  try {
    statusDiv.innerHTML = "Nolasa CSV...";
    csvPoints = await parseCSV(csvInput.files[0]);
    // Iniciē bestDist, bestLASZ
    bestDist = new Array(csvPoints.length).fill(Infinity);
    bestLASZ = new Array(csvPoints.length).fill(null);

    // TODO: izveidot kdIndex no csvPoints, saglabāt, ja vajag
    // un Worker'iem sūtīt kdIndex (vai load to top)...

    // Nolasa LAS galveni
    statusDiv.innerHTML = "Nolasa LAS galveni...";
    lasFile = lasInput.files[0];
    lasInfo = await readLASHeader(lasFile);

    // Aprēķinām chunku sarakstu
    chunkTasks = [];
    let pointsRemaining = lasInfo.numPoints;
    let currentByteOffset = lasInfo.pointDataOffset;
    let totalPointsRead = 0;
    while (pointsRemaining > 0) {
      const chunkPoints = Math.min(CHUNK_SIZE, pointsRemaining);
      const byteLen = chunkPoints * lasInfo.pointRecordLen;

      chunkTasks.push({
        chunkOffset: totalPointsRead, // "pirmā punkta indekss", ne vienmēr vajadzīgs
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

    // Izveido workerus
    createWorkerPool(numWorkers);

    // Sāk scheduling
    // Palaid scheduleChunk tik reižu, cik mums brīvo workeru
    for (let i=0; i<freeWorkers.length; i++) {
      scheduleChunk();
    }

  } catch (err) {
    console.error(err);
    errorDiv.textContent = err.message;
  }
});
