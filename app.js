function parseLAS(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const arrayBuffer = event.target.result;
                const lasLoader = new LASLoader(); // Izmanto pareizo klasi
                lasLoader.load(arrayBuffer).then(las => {
                    const groundPoints = las.points.filter(p => p.classification === 2);
                    const points = groundPoints.map(p => [p.x, p.y, p.z]);
                    resolve(points);
                }).catch(error => {
                    console.error(error);
                    reject("Kļūda LAS faila parsēšanā.");
                });
            } catch (error) {
                console.error(error);
                reject("Kļūda LAS faila parsēšanā.");
            }
        };
        reader.onerror = function() {
            reject("Kļūda LAS faila ielādēšanā.");
        };
        reader.readAsArrayBuffer(file);
    });
}
