// app.js

document.addEventListener('DOMContentLoaded', async () => {
  const processBtn = document.getElementById('processBtn');
  const downloadCSVBtn = document.getElementById('downloadCSVBtn');
  
  let lasPoints = [];
  let csvPoints = [];
  let resultPoints = [];
  let lasTree = null;
  let map = null;
  
  // Inicializē Pyodide
  const pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/"
  });
  console.log("Pyodide ielādēts.");

  // Augšupielādē nepieciešamās Python pakotnes
  await pyodide.loadPackage(['pandas', 'numpy', 'scipy']);
  console.log("Pyodide pakotnes ielādētas.");
  
  // Krāsu klasifikācija
  function classifyZDiff(z) {
    if (z === null || z === undefined || isNaN(z)) {
      return 'white'; // Nav atrasts
    }
    const absZ = Math.abs(z);
    if (absZ <= 0.1) {
      return 'green';
    } else if (absZ <= 0.2) {
      return 'orange';
    } else if (absZ <= 0.5) {
      return 'red';
    } else if (absZ <= 1.0) {
      return 'blue';
    } else {
      return 'purple';
    }
  }
  
  // LAS failu parsēšana ar LAZ-perf
  async function parseLAS(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async function(event) {
        try {
          const arrayBuffer = event.target.result;
          console.log("LAS faila dati ielādēti kā ArrayBuffer.");
          
          // Izmanto LAZ-perf, lai parsētu LAS failu
          const laz = new LazPerf();
          console.log("LAZ-perf instances izveidota.");
  
          const result = await laz.parse(arrayBuffer);
          console.log("LAS fails veiksmīgi parsēts ar LAZ-perf.");
          
          // Filtrē zemes punktus (classification == 2)
          const groundPoints = result.points.filter(p => p.classification === 2);
          console.log(`Atrasti ${groundPoints.length} 'ground' punkti.`);
          
          const points = groundPoints.map(p => ({
            x: p.x,
            y: p.y,
            z: p.z
          }));
          resolve(points);
        } catch (error) {
          console.error("Kļūda LAS faila parsēšanā ar LAZ-perf:", error);
          reject("Kļūda LAS faila parsēšanā.");
        }
      };
      reader.onerror = function() {
        console.error("Kļūda LAS faila ielādēšanā.");
        reject("Kļūda LAS faila ielādēšanā.");
      };
      reader.readAsArrayBuffer(file);
    });
  }
  
  // CSV failu parsēšana
  function parseCSV(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        complete: function(results) {
          const data = results.data;
          // Pārbaude, vai ir X, Y, Z kolonnas
          if (data.length === 0 || (data.length === 1 && !data[0].x)) {
            reject("CSV fails ir tukšs vai neatbilstošs.");
            return;
          }
          const columns = Object.keys(data[0]).map(col => col.toLowerCase());
          if (!columns.includes('x') || !columns.includes('y') || !columns.includes('z')) {
            reject("CSV failam jāietver kolonnas X, Y un Z (jebkurā lieluma burta veidā).");
          } else {
            const points = data.map(row => ({
              x: parseFloat(row.X) || parseFloat(row.x),
              y: parseFloat(row.Y) || parseFloat(row.y),
              z: parseFloat(row.Z) || parseFloat(row.z)
            }));
            resolve(points);
          }
        },
        error: function(error) {
          reject("Kļūda CSV faila parsēšanā: " + error.message);
        }
      });
    });
  }
  
  // KDBush indeksēšana
  function buildLasTree(points) {
    return new KDBush(points, p => p.x, p => p.y, 64, Float64Array);
  }
  
  // Meklē tuvāko LAS punktu
  function findNearestLasPoint(x, y, maxDistance) {
    const radius = maxDistance;
    const ids = lasTree.within(x, y, radius);
    if (ids.length === 0) return null;
    // Atrast tuvāko punktu
    let minDist = Infinity;
    let nearestPoint = null;
    ids.forEach(id => {
      const point = lasPoints[id];
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist < minDist) {
        minDist = dist;
        nearestPoint = point;
      }
    });
    return nearestPoint;
  }
  
  // Apstrāde
  async function processFiles() {
    const lasFileInput = document.getElementById('lasFile');
    const csvFileInput = document.getElementById('csvFile');
    const maxDistance = parseFloat(document.getElementById('maxDistance').value);
    
    if (lasFileInput.files.length === 0 || csvFileInput.files.length === 0) {
      alert("Lūdzu, augšupielādējiet abus failus.");
      return;
    }
    
    const lasFile = lasFileInput.files[0];
    const csvFile = csvFileInput.files[0];
    
    // Parsē LAS failu
    try {
      lasPoints = await parseLAS(lasFile);
      if (lasPoints.length === 0) {
        alert("NAV atrasts neviens 'ground' punkts LAS failā.");
        return;
      }
      lasTree = buildLasTree(lasPoints);
      console.log("LAS punkti ielādēti un indeksēti.");
    } catch (error) {
      alert(error);
      return;
    }
    
    // Parsē CSV failu
    try {
      csvPoints = await parseCSV(csvFile);
      console.log("CSV punkti ielādēti.");
    } catch (error) {
      alert(error);
      return;
    }
    
    // Salīdzina punktus
    resultPoints = csvPoints.map(csvPoint => {
      const nearestLas = findNearestLasPoint(csvPoint.x, csvPoint.y, maxDistance);
      if (nearestLas) {
        const zDiff = csvPoint.z - nearestLas.z;
        return {
          csv_x: csvPoint.x,
          csv_y: csvPoint.y,
          csv_z: csvPoint.z,
          las_x: nearestLas.x,
          las_y: nearestLas.y,
          las_z: nearestLas.z,
          z_diff_m: zDiff
        };
      } else {
        return {
          csv_x: csvPoint.x,
          csv_y: csvPoint.y,
          csv_z: csvPoint.z,
          las_x: null,
          las_y: null,
          las_z: null,
          z_diff_m: null
        };
      }
    });
    
    // Izsauc Python funkciju, lai veiktu detalizētāku salīdzināšanu (ja nepieciešams)
    // Šajā gadījumā salīdzināšana notiek JavaScript pusē
    
    // Rādīt rezultātus
    displayResults();
    
    // Aktivizēt lejupielādes pogu
    downloadCSVBtn.disabled = false;
    
    // Vizualizēt kartē
    visualizeOnMap();
  }
  
  // Rezultātu rādīšana
  function displayResults() {
    const resultsDiv = document.getElementById('results');
    if (resultPoints.length === 0) {
      resultsDiv.innerHTML = "<p>Nekādi rezultāti nav pieejami.</p>";
      return;
    }
    
    // Izveido tabulu
    let tableHTML = "<table><tr><th>CSV X</th><th>CSV Y</th><th>CSV Z</th><th>LAS X</th><th>LAS Y</th><th>LAS Z</th><th>Z_diff (m)</th></tr>";
    resultPoints.forEach(pt => {
      tableHTML += `<tr>
        <td>${pt.csv_x.toFixed(3)}</td>
        <td>${pt.csv_y.toFixed(3)}</td>
        <td>${pt.csv_z.toFixed(3)}</td>
        <td>${pt.las_x !== null ? pt.las_x.toFixed(3) : 'NAV'}</td>
        <td>${pt.las_y !== null ? pt.las_y.toFixed(3) : 'NAV'}</td>
        <td>${pt.las_z !== null ? pt.las_z.toFixed(3) : 'NAV'}</td>
        <td>${pt.z_diff_m !== null ? pt.z_diff_m.toFixed(3) : 'NAV'}</td>
      </tr>`;
    });
    tableHTML += "</table>";
    resultsDiv.innerHTML = tableHTML;
  }
  
  // Kartes vizualizācija ar Leaflet
  function visualizeOnMap() {
    if (map) {
      map.remove();
    }
    map = L.map('map').setView([56.95, 24.11], 13); // Vidējās Latvijas koordinātas
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    resultPoints.forEach(pt => {
      if (pt.las_x !== null && pt.las_y !== null) {
        const color = classifyZDiff(pt.z_diff_m);
        L.circleMarker([pt.las_y, pt.las_x], { // Leaflet izmanto [lat, lon]
          radius: 5,
          color: color,
          fillColor: color,
          fillOpacity: 0.8
        }).addTo(map);
      }
    });
  }
  
  // Lejupielādēt rezultātus kā CSV
  function downloadCSV() {
    const headers = ["CSV_X", "CSV_Y", "CSV_Z", "LAS_X", "LAS_Y", "LAS_Z", "Z_diff"];
    const rows = resultPoints.map(pt => [
      pt.csv_x.toFixed(3),
      pt.csv_y.toFixed(3),
      pt.csv_z.toFixed(3),
      pt.las_x !== null ? pt.las_x.toFixed(3) : '',
      pt.las_y !== null ? pt.las_y.toFixed(3) : '',
      pt.las_z !== null ? pt.las_z.toFixed(3) : '',
      pt.z_diff_m !== null ? pt.z_diff_m.toFixed(3) : ''
    ]);
    
    let csvContent = headers.join(",") + "\n";
    rows.forEach(row => {
      csvContent += row.join(",") + "\n";
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, "z_diff_results.csv");
  }
  
  // Pievieno Apstrādes Pogas Notikumu Klausītāju
  processBtn.addEventListener('click', processFiles);
  
  // Pievieno Lejupielādes Pogas Notikumu Klausītāju
  downloadCSVBtn.addEventListener('click', downloadCSV);
});
