import streamlit as st

st.title("CSV un LAS salīdzināšana (Pyodide)")

st.markdown("### 1️⃣ Augšupielādē failus")
st.markdown("""
<input type="file" id="lasFile" accept=".las,.laz">
<input type="file" id="csvFile" accept=".csv">
<button onclick="runPyodideProcessing()">Sākt apstrādi</button>

<h3>📄 Rezultāts:</h3>
<pre id="output"></pre>

<script>
async function runPyodideProcessing() {
    let pyodide = await loadPyodide();
    await pyodide.loadPackage(["numpy", "pandas", "scipy"]);
    console.log("✅ Pyodide ielādēts!");

    let lasFile = document.getElementById("lasFile").files[0];
    let csvFile = document.getElementById("csvFile").files[0];

    if (!lasFile || !csvFile) {
        alert("⚠️ Lūdzu, augšupielādējiet abu tipu failus!");
        return;
    }

    let lasArrayBuffer = await lasFile.arrayBuffer();
    let csvText = await csvFile.text();

    let code = `
import laspy
import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
from io import BytesIO, StringIO

def process_files(las_bytes, csv_data):
    las_file = BytesIO(las_bytes)
    las = laspy.read(las_file)
    
    ground_mask = (las.classification == 2)
    X, Y, Z = las.x[ground_mask], las.y[ground_mask], las.z[ground_mask]
    las_points = np.vstack((X, Y, Z)).T

    csv_df = pd.read_csv(StringIO(csv_data))
    if not {'X', 'Y', 'Z'}.issubset(csv_df.columns):
        return "⚠️ CSV failam jābūt X, Y, Z kolonnām!"
    
    las_xy = las_points[:, :2]
    tree = cKDTree(las_xy)
    csv_df['LAS_Z'] = np.nan
    csv_df['Z_diff'] = np.nan

    for i, (x, y) in enumerate(csv_df[['X', 'Y']].values):
        dist, idx = tree.query([x, y], k=1)
        if dist <= 0.2:
            csv_df.at[i, 'LAS_Z'] = las_points[idx, 2]
            csv_df.at[i, 'Z_diff'] = csv_df.at[i, 'Z'] - las_points[idx, 2]

    return csv_df.to_csv(index=False)

result = process_files(pyodide.globals['las_bytes'], pyodide.globals['csv_data'])
    `;

    pyodide.globals.set("las_bytes", new Uint8Array(lasArrayBuffer));
    pyodide.globals.set("csv_data", csvText);

    pyodide.runPython(code);
    let output = pyodide.globals.get("result");

    document.getElementById("output").innerText = output;
}
</script>
<script src="https://cdn.jsdelivr.net/pyodide/v0.20.0/full/pyodide.js"></script>
""", unsafe_allow_html=True)
