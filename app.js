// app.js

document.addEventListener('DOMContentLoaded', async () => {
  const processBtn = document.getElementById('processBtn');
  const downloadCSVBtn = document.getElementById('downloadCSVBtn');
  
  let resultPoints = [];
  let map = null;
  
  // Inicializē Pyodide
  const pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/"
  });
  console.log("Pyodide ielādēts.");
  
  // Augšupielādē nepieciešamās Python pakotnes
  await pyodide.loadPackage(['pandas', 'numpy', 'scipy', 'laspy']);
  console.log("Pyodide pakotnes ielādētas.");
  
  // Python skripts, kas tiks izpildīts
  const pythonScript = `
import pandas as pd
import laspy
from scipy.spatial import cKDTree
import json

def parse_las(las_bytes):
    with laspy.open(fileobj=las_bytes) as las_file:
        las = las_file.read()
        ground_points = las.points[las.classification == 2]
        las_df = pd.DataFrame({
            'x': ground_points.x,
            'y': ground_points.y,
            'z': ground_points.z
        })
    return las_df

def compare_points(las_df, csv_df, max_distance):
    # Izveido KD koku no LAS punktiem
    tree = cKDTree(las_df[['x', 'y']])
    
    # Meklē tuvākos LAS punktus CSV punktiem
    distances, indices = tree.query(csv_df[['x', 'y']], distance_upper_bound=max_distance)
    
    # Sagatavo rezultātus
    csv_df['las_x'] = las_df.loc[indices, 'x'].values
    csv_df['las_y'] = las_df.loc[indices, 'y'].values
    csv_df['las_z'] = las_df.loc[indices, 'z'].values
    csv_df['z_diff_m'] = csv_df['z'] - csv_df['las_z']
    
    # Atzīmē punktus bez tuvākiem LAS punktiem
    csv_df.loc[distances == float('inf'), ['las_x', 'las_y', 'las_z', 'z_diff_m']] = None
    
    return csv_df

def process(las_bytes, csv_bytes, max_distance):
    las_df = parse_las(las_bytes)
    csv_df = pd.read_csv(csv_bytes)
    
    # Pārliecinās, ka CSV failam ir X, Y, Z kolonnas
    csv_df = csv_df[['x', 'y', 'z']]
    
    result_df = compare_points(las_df, csv_df, max_distance)
    
    # Pārvērš rezultātu DataFrame uz JSON
    return result_df.to_json(orient='records')
  `;
  
  // Izpilda Python skriptu Pyodide
  await pyodide.runPythonAsync(pythonScript);
  console.log("Python skripts izpildīts.");
  
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
    
    // Nolasīt LAS failu kā ArrayBuffer
    const lasArrayBuffer = await lasFile.arrayBuffer();
    console.log("LAS faila dati ielādēti kā ArrayBuffer.");
    
    // Nolasīt CSV failu kā tekstu
    const csvText = await csvFile.text();
    console.log("CSV faila dati ielādēti kā teksts.");
    
    // Saglabāt LAS faila bytes objektā Pyodide FS
    pyodide.FS.writeFile('uploaded.las', new Uint8Array(lasArrayBuffer));
    console.log("LAS fails saglabāts Pyodide FS.");
    
    // Saglabāt CSV faila saturu kā stringu Pyodide FS
    pyodide.FS.writeFile('uploaded.csv', csvText);
    console.log("CSV fails saglabāts Pyodide FS.");
    
    // Izsaukt Python funkciju 'process'
    try {
      const resultJson = pyodide.runPython(`
import io
from process import process

with open('uploaded.las', 'rb') as f_las:
    las_bytes = io.BytesIO(f_las.read())

with open('uploaded.csv', 'r') as f_csv:
    csv_bytes = io.StringIO(f_csv.read())

result = process(las_bytes, csv_bytes, ${maxDistance})
result
      `);
      console.log("Python funkcija izpildīta.");
      
      // Parsēt rezultātu JSON
      resultPoints = JSON.parse(resultJson);
      
      if (resultPoints.length === 0) {
        alert("Rezultātu nav atrasti.");
        return;
      }
      
      // Rādīt rezultātus
      displayResults();
      
      // Aktivizēt lejupielādes pogu
      downloadCSVBtn.disabled = false;
      
      // Vizualizēt kartē
      visualizeOnMap();
      
    } catch (error) {
      console.error("Kļūda Python funkcijas izpildē:", error);
      alert("Kļūda apstrādājot failus ar Python.");
    }
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
        <td>${pt.csv_x !== null ? pt.csv_x.toFixed(3) : 'NAV'}</td>
        <td>${pt.csv_y !== null ? pt.csv_y.toFixed(3) : 'NAV'}</td>
        <td>${pt.csv_z !== null ? pt.csv_z.toFixed(3) : 'NAV'}</td>
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
      pt.csv_x !== null ? pt.csv_x.toFixed(3) : '',
      pt.csv_y !== null ? pt.csv_y.toFixed(3) : '',
      pt.csv_z !== null ? pt.csv_z.toFixed(3) : '',
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
