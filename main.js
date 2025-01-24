// main.js

// HTML elementu references
const csvInput = document.getElementById("csvFile");
const lasInput = document.getElementById("lasFile");
const processBtn = document.getElementById("processBtn");
const errorDiv = document.getElementById("error");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");

// GLOBĀLI: CSV punkti, k-d tree, un masīvs rezultātiem
let csvPoints = [];
let kdIndex = null; // k-d tree no CSV
let bestLASZ = [];  // var glabāt labāko LAS Z katram CSV punktam
let bestDist = [];  // labākais attālums

// Konstantes
const CHUNK_SIZE = 200_000; // vienā chunk cik LAS punktus lasām
const RADIUS = 0.2;         // 20 cm

// 1) CSV lasīšana
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
            return {x:X,y:Y,z:Z};
          }).filter(p => !isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z));
          resolve(pts);
        } catch (err) { reject(err); }
      },
      error: err => reject(err)
    });
  });
}

// 2) Minimālā LAS galvenes nolasīšana
async function readLASHeader(file) {
  const headerSize = 375; // drošības rezerve
  const buf = await file.slice(0, headerSize).arrayBuffer();
  const dv = new DataView(buf);

  // "LASF"?
  const sig = String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3));
  if (sig !== "LASF") throw new Error("Nav 'LASF' signatūra");

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
    throw new Error("Neparedzēts Point Data Format: "+pointFormat);
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

// 3) Izveido Web Worker
//    (Var veidot vairākus, lai paralēli apstrādātu chunkus,
//     šeit demonstrācijai - veidojam 1 worker)
let worker;
function setupWorker(csvPoints, kdTree) {
  worker = new Worker('./worker.js');

  // Kad workers sūta atpakaļ starprezultātu:
  worker.onmessage = (evt) => {
    const msg = evt.data;
    if (msg.type === 'chunkResult') {
      // msg.payload satur chunk apstrādes iznākumu
      // Mēs sagaidām masīvu "updates" formā:
      //   updates = [ { idx: CSV_index, dist: newDist, lasZ: newLASZ }, ... ]
      // Kad redzam update, salīdzinām ar bestDist un atjaunojam
      for (const u of msg.payload) {
        if (u.dist < bestDist[u.idx]) {
          bestDist[u.idx] = u.dist;
          bestLASZ[u.idx] = u.lasZ;
        }
      }
      // Apstrāde chunkam pabeigta - varam turpināt lasīt nākamo
      readNextChunk();
    }
    else if (msg.type === 'log') {
      console.log("Worker:", msg.payload);
    }
    else if (msg.type === 'done') {
      // Visi chunki pabeigti?
      finalizeResults();
    }
  };

  // Nosūtām workerim CSV un k-d tree datus
  // (Atkarīgs no tā, kā k-d tree iemiesots. Šeit parādīsim "naivo" variantu.)
  worker.postMessage({
    type: 'initCSV',
    csvPoints,
    radius: RADIUS,
  });
}

// 4) Chunk lasīšanas mainīgie
let lasFile;            // saglabājam failu
let lasInfo;            // {numPoints, pointDataOffset, pointRecordLen, scale, offset}
let totalPointsRead = 0;
let pointsRemaining = 0;
let currentByteOffset = 0;

// 5) Uzsāk lasīšanas ciklu
function startLASReading() {
  totalPointsRead = 0;
  pointsRemaining = lasInfo.numPoints;
  currentByteOffset = lasInfo.pointDataOffset;

  // Uzreiz sākam lasīt chunk
  readNextChunk();
}

// 6) Funkcija nolasīt nākamo chunk
async function readNextChunk() {
  if (pointsRemaining <= 0) {
    // Ja vairs nav punktu, paziņojam workerim “pabeigts”
    worker.postMessage({type:'noMoreChunks'});
    return;
  }

  const chunkPoints = Math.min(CHUNK_SIZE, pointsRemaining);
  // Izvadam statusu
  statusDiv.innerHTML = `Apstrādā punktus: ${totalPointsRead+1}..${totalPointsRead+chunkPoints} (no ${lasInfo.numPoints})`;

  // Nolasām chunk no faila
  const chunkBytes = chunkPoints * lasInfo.pointRecordLen;
  const blob = lasFile.slice(currentByteOffset, currentByteOffset + chunkBytes);
  const arrayBuf = await blob.arrayBuffer();

  // Nosūtām worker'am apstrādei
  worker.postMessage({
    type: 'processChunk',
    buffer: arrayBuf,
    chunkPoints,
    pointRecordLen: lasInfo.pointRecordLen,
    scale: lasInfo.scale,
    offset: lasInfo.offset,
    radius: RADIUS
  }, [arrayBuf]); // 2. parametrs: "transfer" - nododam bufferu bez kopēšanas

  // Atjaunojam rādītājus
  currentByteOffset += chunkBytes;
  pointsRemaining -= chunkPoints;
  totalPointsRead += chunkPoints;
}

// 7) Kad Worker pateiks 'done', izdrukājam rezultātu
function finalizeResults() {
  statusDiv.innerHTML = "Visi chunki pabeigti! Veido tabulu...";
  // Izveidojam HTML
  let html = "<table><tr><th>CSV X</th><th>CSV Y</th><th>CSV Z</th><th>LAS Z</th><th>ΔZ</th><th>Dist</th></tr>";
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
}

// 8) Pogas event
processBtn.addEventListener('click', async ()=> {
  errorDiv.textContent = "";
  resultsDiv.innerHTML = "";
  statusDiv.innerHTML = "";

  if (!csvInput.files.length || !lasInput.files.length) {
    errorDiv.textContent = "Atlasiet gan CSV, gan LAS failu!";
    return;
  }

  try {
    // 1) Nolasa CSV
    statusDiv.innerHTML = "Nolasa CSV...";
    csvPoints = await parseCSV(csvInput.files[0]);

    // Iniciējam bestDist, bestLASZ
    bestDist = new Array(csvPoints.length).fill(Infinity);
    bestLASZ = new Array(csvPoints.length).fill(null);

    // TODO: 2) Izveidot k-d tree CSV pusē
    // Šim piemēram parādām loģiku, bet reālajā projektā
    // var izmantot, piem., "kdbush" vai "rbush"
    // Pagaidām - worker 'mock' - parādīsim, ka sūtam CSV workerim
    // (Sk. worker.js)

    // 3) Nolasa LAS galveni
    statusDiv.innerHTML = "Nolasa LAS galveni...";
    lasFile = lasInput.files[0];
    lasInfo = await readLASHeader(lasFile);

    // 4) Uzsāk worker
    setupWorker(csvPoints/*, kdIndex*/);

    // 5) Sāk chunk lasīšanas ciklu
    startLASReading();

  } catch (err) {
    console.error(err);
    errorDiv.textContent = err.message;
  }
});
