function downloadCsv(csvContent) {
    if (!csvContent || csvContent === 'undefined') {
        alert("Nav ko lejupielādēt.");
        return;
    }
    let blob = new Blob([csvContent], { type: "text/csv" });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "las_vs_csv_results.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
