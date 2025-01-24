// After reading the LAS file as ArrayBuffer
lasReader.onload = async function(eventLas) {
    let lasArrayBuffer = eventLas.result;
    // Initialize LAS parser (example with las-js)
    let las = LASParser.parse(lasArrayBuffer);
    let lasPoints = las.points.map(point => [point.x, point.y, point.z]);

    // Now pass lasPoints to Python via Pyodide
    // You might need to serialize it as JSON
    let lasPointsJSON = JSON.stringify(lasPoints);

    let pyodide = await loadPyodide();
    await pyodide.loadPackage(["numpy", "pandas", "scipy"]);

    let code = `
