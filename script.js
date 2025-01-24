let maxDistance = 0.1; // Noklusējuma attālums (metros)

function updateDistance() {
    let userDistance = parseFloat(document.getElementById("distance").value);
    if (userDistance < 1) {
        alert("Attālumam jābūt vismaz 1 cm!");
        return;
    }
    maxDistance = userDistance / 100; // Pārvērš cm uz metrus
    document.getElementById("distanceDisplay").innerText = "Izvēlētais attālums: " + userDistance + " cm";
}

async function processFiles() {
    let csvFile = document.getElementById("csvFile").files[0];

    if (!csvFile) {
        document.getElementById("output").innerText = "Lūdzu, augšupielādējiet CSV failu!";
        return;
    }

    let reader = new FileReader();
    reader.onload = async function(event) {
        let csvData = event.target.result;
        let pyodide = await loadPyodide();
        await pyodide.loadPackage(["numpy", "pandas", "scipy"]);

        let code = `
import pandas as pd
import numpy as np
from scipy.spatial import cKDTree
from io import StringIO

csv_df = pd.read_csv(StringIO("""${csvData}"""))
csv_points = csv_df[['x', 'y', 'z']].to_numpy()

# Simulēti LAS punkti (šis ir piemērs, jo LAS fails nav apstrādājams Pyodide vidē)
las_points = np.random.rand(len(csv_points), 3) * 100  # Simulējam 100x100m punktu sadalījumu

# KDTree tuvāko punktu meklēšanai
tree = cKDTree(las_points[:, :2])
distances, indices = tree.query(csv_points[:, :2], distance_upper_bound=${maxDistance})

# Aprēķinām Z atšķirību, ja punkts ir atrasts attālumā
csv_df["Z_Difference"] = np.where(distances < ${maxDistance}, csv_points[:, 2] - las_points[indices, 2], np.nan)

# Sagatavojam CSV rezultātu
result_csv = csv_df.to_csv(index=False)
result_csv
        `;

        try {
            let result = await pyodide.runPythonAsync(code);
            document.getElementById("output").innerText = "Rezultāti sagatavoti. Lejupielādējiet CSV.";
            downloadCsv(result);
        } catch (error) {
            document.getElementById("output").innerText = "Kļūda apstrādājot failus.";
            console.error(error);
        }
    };
    reader.readAsText(csvFile);
}

function downloadCsv(csvContent) {
    let blob = new Blob([csvContent], { type: "text/csv" });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "las_vs_csv_results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Nodrošina, ka `processFiles()` ir pieejama HTML pogām
window.processFiles = processFiles;
window.updateDistance = updateDistance;
