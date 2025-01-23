document.addEventListener('DOMContentLoaded', () => {
  const processBtn = document.getElementById('processBtn');
  const downloadCSVBtn = document.getElementById('downloadCSVBtn');
  
  let csvPoints1 = [];
  let csvPoints2 = [];
  let resultPoints = [];
  let csvTree = null;
  let map = null;
  
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
  function buildCsvTree(points) {
    return new KDBush(points, p => p.x, p => p.y, 64, Float64Array);
  }
  
  // Meklē tuvāko CSV punktu
  function findNearestCsvPoint(x, y, maxDistance) {
    const radius = maxDistance;
    const ids = csvTree.within(x, y, radius);
    if (ids.length === 0) return null;
    // Atrast tuvāko punktu
    let minDist = Infinity;
    let nearestPoint = null;
    ids.forEach(id => {
      const point = csvPoints1[id];
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
    const csvFileInput1 = document.getElementById('csvFile1');
    const csvFileInput2 = document.getElementById('csvFile2');
    const maxDistance = parseFloat(document.getElementById('maxDistance').value);
    
    if (csvFileInput1.files.length === 0 || csvFileInput2.files.length === 0) {
      alert("Lūdzu, augšupielādējiet abus CSV failus.");
      return;
    }
    
    const csvFile1 = csvFileInput1.files[0];
    const csvFile2 = csvFileInput2.files[0];
    
    // Parsē pirmo CSV failu (Oriģinālais)
    try {
      csvPoints1 = await parseCSV(csvFile1);
      if (csvPoints1.length === 0) {
        alert("Pirmajā CSV failā nav punktu.");
        return;
      }
      csvTree = buildCsvTree(csvPoints1);
      console.log("Pirmais CSV fails ielādēts un indeksēts.");
    } catch (error) {
      alert(error);
      return;
    }
    
    // Parsē otro CSV failu (LAS konvertēts)
    try {
      csvPoints2 = await parseCSV(csvFile2);
      if (csvPoints2.length === 0) {
        alert("Otrajā CSV failā nav punktu.");
        return;
      }
      console.log("Otrais CSV fails ielādēts.");
    } catch (error) {
      alert(error);
      return;
    }
    
    // Salīdzina punktus
    resultPoints = csvPoints2.map(csvPoint => {
      const nearestCsv = findNearestCsvPoint(csvPoint.x, csvPoint.y, maxDistance);
      if (nearestCsv) {
        const zDiff = csvPoint.z - nearestCsv.z;
        return {
          csv1_x: nearestCsv.x,
          csv1_y: nearestCsv.y,
          csv1_z: nearestCsv.z,
          csv2_x: csvPoint.x,
          csv2_y: csvPoint.y,
          csv2_z: csvPoint.z,
          z_diff_m: zDiff
        };
      } else {
        return {
          csv1_x: null,
          csv1_y: null,
          csv1_z: null,
          csv2_x: csvPoint.x,
          csv2_y: csvPoint.y,
          csv2_z: csvPoint.z,
          z_diff_m: null
        };
      }
    });
    
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
    let tableHTML = "<table><tr><th>CSV1 X</th><th>CSV1 Y</th><th>CSV1 Z</th><th>CSV2 X</th><th>CSV2 Y</th><th>CSV2 Z</th><th>Z_diff (m)</th></tr>";
    resultPoints.forEach(pt => {
      tableHTML += `<tr>
        <td>${pt.csv1_x !== null ? pt.csv1_x.toFixed(3) : 'NAV'}</td>
        <td>${pt.csv1_y !== null ? pt.csv1_y.toFixed(3) : 'NAV'}</td>
        <td>${pt.csv1_z !== null ? pt.csv1_z.toFixed(3) : 'NAV'}</td>
        <td>${pt.csv2_x.toFixed(3)}</td>
        <td>${pt.csv2_y.toFixed(3)}</td>
        <td>${pt.csv2_z.toFixed(3)}</td>
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
    map = L.map('map').setView([56.95, 24.11], 13); // Vidējais Latvija koordinātu
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    
    resultPoints.forEach(pt => {
      if (pt.csv1_x !== null && pt.csv1_y !== null) {
        const color = classifyZDiff(pt.z_diff_m);
        L.circleMarker([pt.csv1_y, pt.csv1_x], { // Leaflet izmanto [lat, lon]
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
    const headers = ["CSV1_X", "CSV1_Y", "CSV1_Z", "CSV2_X", "CSV2_Y", "CSV2_Z", "Z_diff"];
    const rows = resultPoints.map(pt => [
      pt.csv1_x !== null ? pt.csv1_x.toFixed(3) : '',
      pt.csv1_y !== null ? pt.csv1_y.toFixed(3) : '',
      pt.csv1_z !== null ? pt.csv1_z.toFixed(3) : '',
      pt.csv2_x.toFixed(3),
      pt.csv2_y.toFixed(3),
      pt.csv2_z.toFixed(3),
      pt.z_diff_m !== null ? pt.z_diff_m.toFixed(3) : ''
    ]);
    
    let csvContent = headers.join(",") + "\n";
    rows.forEach(row => {
      csvContent += row.join(",") + "\n";
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, "z_diff_results.csv");
  }
  
  // Pievieno apstrādes pogas notikumu klausītāju
  processBtn.addEventListener('click', processFiles);
  
  // Pievieno lejupielādes pogas notikumu klausītāju
  downloadCSVBtn.addEventListener('click', downloadCSV);
});
