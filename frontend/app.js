//
// app.js
//

// CONSTANTS for paths
const CSV_BASE_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/data/all_csv/";
const TABLE_TO_PAGE_JSON_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/data/table_to_page.json";
const TOTAL_EXAMPLES_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/tokenized_data/total_examples.json";
const R1_TRAINING_ALL_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/collected_data/r1_training_all.json";
const R2_TRAINING_ALL_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/collected_data/r2_training_all.json";
const FULL_CLEANED_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/tokenized_data/full_cleaned.json";
const MANIFEST_JSON_PATH = "results/manifest.json";

// point to Ollama’s API server
const BACKEND_URL = "http://127.0.0.1:11434";

// Global variables for precomputed results
let allResults = [];               
let tableIdToResultsMap = {};      
let availableOptions = {
  models: new Set(),
  datasets: new Set(),
  learningTypes: new Set(),
  nValues: new Set(),
  formatTypes: new Set()
};
let tableToPageMap = {};  // csv filename -> [title, link]
let resultsChartInstance = null;
let manifestOptions = []; // Array of manifest options for filtering

// DOM element references
const modelLoadingStatusEl = document.getElementById("modelLoadingStatus");
const liveThinkOutputEl = document.getElementById("liveThinkOutput");
const liveStreamOutputEl = document.getElementById("liveStreamOutput");

window.modelLoaded = true;
let globalReader = null;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    try {
      tableToPageMap = await fetchTableToPage();
    } catch (e) {
      console.warn("Failed to fetch table_to_page.json. Continuing without it.", e);
      tableToPageMap = {};
    }

    let manifest;
    try {
      manifest = await fetchManifest();
      if (!manifest.results_files || !Array.isArray(manifest.results_files)) {
        console.warn("Manifest does not contain results_files. Using an empty list.");
        manifest.results_files = [];
      }
      parseManifest(manifest); // Populate manifestOptions

      const globalModels = Array.from(new Set(manifestOptions.map(o => o.model))).sort();
      const globalDatasets = Array.from(new Set(manifestOptions.map(o => o.dataset))).sort();
      const globalLearningTypes = Array.from(new Set(manifestOptions.map(o => o.learningType))).sort();
      const globalNValues = Array.from(new Set(manifestOptions.map(o => o.nValue))).sort((a, b) => {
        if (a === "all") return 1;
        if (b === "all") return -1;
        return parseInt(a) - parseInt(b);
      });
      const globalFormatTypes = Array.from(new Set(manifestOptions.map(o => o.formatType))).sort();
      
      populateAllDropdowns();
      ["modelSelect", "datasetSelect", "learningTypeSelect", "nValueSelect", "formatTypeSelect"].forEach(id => {
        document.getElementById(id).addEventListener("change", updateDropdownsAndDisableInvalidOptions);
      });
      updateDropdownsAndDisableInvalidOptions();

    } catch (manifestError) {
      console.warn("Failed to fetch or parse manifest.json. Continuing without manifest.", manifestError);
    }

    await fetchTotalExamplesClaims();
    await fetchFullCleaned();

    populateExistingTableDropdown();
    addLoadButtonListener();
    setupTabSwitching();
    setupLiveCheckEvents();

    const fileUpload = document.getElementById("fileUpload");
    if (fileUpload) {
      fileUpload.addEventListener("change", function(e) {
        const file = e.target.files[0];
        if (file) {
          // Validate file size (e.g., 2MB limit)
          const maxSize = 2 * 1024 * 1024; // 2MB in bytes
          if (file.size > maxSize) {
            alert("CSV file is too large. Please upload a file smaller than 2MB.");
            return;
          }
          const reader = new FileReader();
          reader.onload = function(e) {
            const fileContent = e.target.result;
            const inputTableEl = document.getElementById("inputTable");
            inputTableEl.value = fileContent;
            renderLivePreviewTable(fileContent, []);
            validateLiveCheckInputs();
          };
          reader.readAsText(file);
        }
      });
    }

    const toggleMetricsEl = document.getElementById("performanceMetricsToggle");
    const toggleArrow = document.getElementById("toggleArrow");
    toggleMetricsEl.addEventListener("click", function() {
      const metricsContent = document.getElementById("metricsContent");
      if (metricsContent.style.display === "none") {
        metricsContent.style.display = "block";
        toggleArrow.textContent = "▼";
        updateNativeMetrics();
      } else {
        metricsContent.style.display = "none";
        toggleArrow.textContent = "►";
      }
    });
    validateLiveCheckInputs();

  } catch (error) {
    console.error("Initialization failed:", error);
    document.getElementById("infoPanel").innerHTML = `<p style="color:red;">Failed to initialize the app: ${error}</p>`;
  }
});

async function fetchTableToPage() {
  const response = await fetch(TABLE_TO_PAGE_JSON_PATH);
  if (!response.ok) {
    console.warn("Failed to fetch table_to_page.json. Titles/links won't be shown.");
    return {};
  }
  return response.json();
}

async function fetchManifest() {
  const response = await fetch(MANIFEST_JSON_PATH);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest.json: ${response.status} ${response.statusText}`);
  }
  const manifest = await response.json();
  if (!manifest.results_files || !Array.isArray(manifest.results_files)) {
    throw new Error("Invalid manifest.json format. Missing 'results_files' array.");
  }
  return manifest;
}

function parseManifest(manifest) {
  manifest.results_files.forEach(filename => {
    const shortName = filename.replace(/^results\//, "");
    const regex = /^results_with_cells_(.+?)_(test_examples|val_examples)_(\d+|all)_(zero_shot|one_shot|few_shot|chain_of_thought)_(naturalized|markdown|json|html)\.json$/;
    const match = shortName.match(regex);
    if (match) {
      const [_, model, dataset, nValue, learningType, formatType] = match;
      manifestOptions.push({ model, dataset, nValue, learningType, formatType, filename });
    } else {
      console.warn(`Filename "${filename}" does not match expected pattern; ignoring.`);
    }
  });
}

function populateAllDropdowns() {
  const models = Array.from(new Set(manifestOptions.map(opt => opt.model))).sort();
  const datasets = Array.from(new Set(manifestOptions.map(opt => opt.dataset))).sort();
  const learningTypes = Array.from(new Set(manifestOptions.map(opt => opt.learningType))).sort();
  const nValues = Array.from(new Set(manifestOptions.map(opt => opt.nValue))).sort((a, b) => {
    if (a === "all") return 1;
    if (b === "all") return -1;
    return parseInt(a) - parseInt(b);
  });
  const formatTypes = Array.from(new Set(manifestOptions.map(opt => opt.formatType))).sort();

  populateSelect("modelSelect", models, "", true);
  populateSelect("datasetSelect", datasets, "", true);
  populateSelect("learningTypeSelect", learningTypes, "", true);
  populateSelect("nValueSelect", nValues, "", true);
  populateSelect("formatTypeSelect", formatTypes, "", true);
}

function isValidCombination(model, dataset, learningType, nValue, formatType) {
  return manifestOptions.some(opt => {
    if (model && opt.model !== model) return false;
    if (dataset && opt.dataset !== dataset) return false;
    if (learningType && opt.learningType !== learningType) return false;
    if (nValue && opt.nValue !== nValue) return false;
    if (formatType && opt.formatType !== formatType) return false;
    return true;
  });
}

function updateDropdownDisabledState(dropdownId, isValidCandidate) {
  const selectEl = document.getElementById(dropdownId);
  Array.from(selectEl.options).forEach(option => {
    if (option.value === "") {
      option.disabled = false;
    } else {
      option.disabled = !isValidCandidate(option.value);
    }
  });
}

function updateDropdownsAndDisableInvalidOptions() {
  const currentModel = document.getElementById("modelSelect").value;
  const currentDataset = document.getElementById("datasetSelect").value;
  const currentLearningType = document.getElementById("learningTypeSelect").value;
  const currentNValue = document.getElementById("nValueSelect").value;
  const currentFormatType = document.getElementById("formatTypeSelect").value;

  updateDropdownDisabledState("modelSelect", candidate =>
    isValidCombination(candidate, currentDataset, currentLearningType, currentNValue, currentFormatType)
  );
  updateDropdownDisabledState("datasetSelect", candidate =>
    isValidCombination(currentModel, candidate, currentLearningType, currentNValue, currentFormatType)
  );
  updateDropdownDisabledState("learningTypeSelect", candidate =>
    isValidCombination(currentModel, currentDataset, candidate, currentNValue, currentFormatType)
  );
  updateDropdownDisabledState("nValueSelect", candidate =>
    isValidCombination(currentModel, currentDataset, currentLearningType, candidate, currentFormatType)
  );
  updateDropdownDisabledState("formatTypeSelect", candidate =>
    isValidCombination(currentModel, currentDataset, currentLearningType, currentNValue, candidate)
  );

  const loadBtn = document.getElementById("loadBtn");
  const allValues = [currentModel, currentDataset, currentLearningType, currentNValue, currentFormatType];
  if (allValues.some(v => v === "")) {
    loadBtn.disabled = true;
    loadBtn.style.cursor = "not-allowed";
    loadBtn.style.opacity = "0.5";
    loadBtn.style.pointerEvents = "auto";
  } else {
    loadBtn.disabled = false;
    loadBtn.style.cursor = "pointer";
    loadBtn.style.opacity = "1";
    loadBtn.style.pointerEvents = "auto";
  }
}

async function fetchTotalExamplesClaims() {
  try {
    const response1 = await fetch(R1_TRAINING_ALL_PATH);
    const response2 = await fetch(R2_TRAINING_ALL_PATH);

    if (!response1.ok || !response2.ok) {
      console.warn("Failed to fetch one or both training data files.");
      return;
    }

    const r1Data = await response1.json();
    const r2Data = await response2.json();

    tableIdToClaimsMap = { ...r1Data, ...r2Data };

  } catch (err) {
    console.warn("Could not load training data:", err);
    tableIdToClaimsMap = {};
  }
}

async function fetchFullCleaned() {
  try {
    const response = await fetch(FULL_CLEANED_PATH);
    if (!response.ok) {
      console.warn("Failed to fetch full_cleaned.json");
      return;
    }
    tableEntityLinkingMap = await response.json();
  } catch (err) {
    console.warn("Error fetching full_cleaned.json", err);
  }
}

function populateSelect(selectId, values, currentSelection = "", includeAny = true) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = "";
  if (includeAny) {
    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "Select";
    sel.appendChild(anyOption);
  }
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  if (currentSelection && values.includes(currentSelection)) {
    sel.value = currentSelection;
  } else {
    sel.value = includeAny ? "" : (values.length > 0 ? values[0] : "");
  }
}

function populateDropdowns() {
  populateSelect("modelSelect", Array.from(availableOptions.models).sort());
  populateSelect("datasetSelect", Array.from(availableOptions.datasets).sort());
  populateSelect("learningTypeSelect", Array.from(availableOptions.learningTypes).sort());
  populateSelect("nValueSelect", Array.from(availableOptions.nValues).sort((a, b) => {
    if (a === "all") return 1;
    if (b === "all") return -1;
    return parseInt(a) - parseInt(b);
  }));
  populateSelect("formatTypeSelect", Array.from(availableOptions.formatTypes).sort());
}

function addLoadButtonListener() {
  const loadBtn = document.getElementById("loadBtn");
  if (loadBtn) loadBtn.addEventListener("click", loadResults);
}

async function loadResults() {
  const modelName = document.getElementById("modelSelect").value;
  const datasetName = document.getElementById("datasetSelect").value;
  const learningType = document.getElementById("learningTypeSelect").value;
  const nValue = document.getElementById("nValueSelect").value;
  const formatType = document.getElementById("formatTypeSelect").value;
  const resultsFileName = `results/results_with_cells_${modelName}_${datasetName}_${nValue}_${learningType}_${formatType}.json`;
  
  const infoPanel = document.getElementById("infoPanel");
  infoPanel.innerHTML = `<p>Loading results ...</p>`;

  try {
    const response = await fetch(resultsFileName);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    allResults = await response.json();
    infoPanel.innerHTML = `<p>Loaded <strong>${allResults.length}</strong> results for the <strong>${modelName}</strong> model (dataset: ${datasetName}, learning type: ${learningType}, n-value: ${nValue}, format: ${formatType}).</p>`;
    buildTableMap();
    populateTableSelect();
    document.getElementById("tableDropDown").style.display = "block";
    document.getElementById("tableMetaInfo").style.display = "block";
    document.getElementById("performanceMetrics").style.display = "block";
    updateNativeMetrics();
  } catch (err) {
    console.error(`Failed to load ${resultsFileName}:`, err);
    infoPanel.innerHTML = `<p style="color:red;">Failed to load results: ${err}</p>`;
    allResults = [];
    tableIdToResultsMap = {};
    document.getElementById("tableSelect").innerHTML = "";
    document.getElementById("tableSelect").disabled = true;
    document.getElementById("claimList").innerHTML = "";
    document.getElementById("table-container").innerHTML = "";
  }
}

function buildTableMap() {
  tableIdToResultsMap = {};
  allResults.forEach(item => {
    const tid = item.table_id;
    if (!tableIdToResultsMap[tid]) tableIdToResultsMap[tid] = [];
    tableIdToResultsMap[tid].push(item);
  });
}

function populateTableSelect() {
  const tableSelect = document.getElementById("tableSelect");
  tableSelect.innerHTML = "";
  const tableIds = Object.keys(tableIdToResultsMap);
  if (tableIds.length === 0) {
    tableSelect.disabled = true;
    tableSelect.innerHTML = `<option value="">No tables available</option>`;
    return;
  }
  tableSelect.disabled = false;
  tableIds.forEach(tid => {
    const option = document.createElement("option");
    option.value = tid;
    let title = tableToPageMap[tid] ? tableToPageMap[tid][0] : "";
    option.textContent = title ? `${tid} - ${title}` : tid;
    tableSelect.appendChild(option);
  });
  tableSelect.removeEventListener("change", onTableSelectChange);
  tableSelect.addEventListener("change", onTableSelectChange);
  tableSelect.value = tableIds[0];
  onTableSelectChange();

  if (window.tableSelectChoices) {
    window.tableSelectChoices.destroy();
  }
  window.tableSelectChoices = new Choices('#tableSelect', {
    searchEnabled: true,
    itemSelectText: '',
    shouldSort: false
  });
}

function onTableSelectChange() {
  const tableSelect = document.getElementById("tableSelect");
  const selectedTid = tableSelect.value;
  showClaimsForTable(selectedTid);
  updateResultsChart(selectedTid);
}

function showClaimsForTable(tableId) {
  const claimListDiv = document.getElementById("claimList");
  claimListDiv.innerHTML = "";
  const container = document.getElementById("table-container");
  container.innerHTML = "";
  const itemsForTable = tableIdToResultsMap[tableId] || [];
  itemsForTable.forEach((res, idx) => {
    const div = document.createElement("div");
    div.className = "claim-item";
    const isCorrect = res.predicted_response === res.true_response;
    div.classList.add(isCorrect ? "correct" : "incorrect");
    const symbolSpan = document.createElement("span");
    symbolSpan.className = "result-symbol";
    symbolSpan.textContent = isCorrect ? "✓" : "✕";
    const claimText = document.createTextNode(`Claim #${idx + 1}: ${res.claim}`);
    div.appendChild(symbolSpan);
    div.appendChild(claimText);
    div.addEventListener("click", () => {
      document.querySelectorAll(".claim-item").forEach(item => item.classList.remove("selected"));
      div.classList.add("selected");
      renderClaimAndTable(res);
    });
    claimListDiv.appendChild(div);
  });
  if (itemsForTable.length > 0) {
    claimListDiv.firstChild.click();
  }
}

async function renderClaimAndTable(resultObj) {
  document.getElementById("full-highlight-legend-precomputed").style.display = "none";
  document.getElementById("full-entity-highlight-legend-precomputed").style.display = "none";
  const container = document.getElementById("table-container");
  container.innerHTML = "";
  const infoDiv = document.createElement("div");
  infoDiv.className = "info-panel";
  infoDiv.innerHTML = `
    <p><strong>Claim:</strong> ${resultObj.claim}</p>
    <p><strong>Predicted:</strong> ${resultObj.predicted_response ? "TRUE" : "FALSE"}</p>
    <p><strong>Raw Output:</strong> ${resultObj.resp}</p>
    <p><strong>Ground Truth:</strong> ${resultObj.true_response ? "TRUE" : "FALSE"}</p>
  `;
  container.appendChild(infoDiv);

  const metaDiv = document.getElementById("tableMetaInfo");
  metaDiv.innerHTML = "";
  const meta = tableToPageMap[resultObj.table_id];
  if (meta) {
    const [tableTitle, wikipediaUrl] = meta;
    metaDiv.innerHTML = `
      <p><strong>Table Title:</strong> ${tableTitle}</p>
      <p><strong>Wikipedia Link:</strong> <a href="${wikipediaUrl}" target="_blank">${wikipediaUrl}</a></p>
    `;
  } else {
    metaDiv.innerHTML = `<p><em>No title/link found for this table</em></p>`;
  }

  const csvFileName = resultObj.table_id;
  const csvUrl = CSV_BASE_PATH + csvFileName;
  let csvText = "";
  try {
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error(`Status: ${resp.status}`);
    csvText = await resp.text();
  } catch (err) {
    const errMsg = document.createElement("p");
    errMsg.style.color = "red";
    errMsg.textContent = `Failed to load CSV from ${csvUrl}: ${err}`;
    container.appendChild(errMsg);
    return;
  }
  
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  const tableData = lines.map(line => line.split("#"));
  if (!tableData.length) {
    container.appendChild(document.createElement("p")).textContent = "Table is empty or could not be parsed.";
    return;
  }
  
  const columns = tableData[0];
  const dataRows = tableData.slice(1);
  
  const tableEl = document.createElement("table");
  tableEl.classList.add("styled-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  tableEl.appendChild(thead);
  
  const tbody = document.createElement("tbody");
  dataRows.forEach((rowVals, rowIndex) => {
    const tr = document.createElement("tr");
    rowVals.forEach((cellVal, colIndex) => {
      const td = document.createElement("td");
      td.textContent = cellVal;
      const columnName = columns[colIndex];
      const shouldHighlight = resultObj.relevant_cells.some(
        hc => hc.row_index === rowIndex &&
              hc.column_name.trim().toLowerCase() === columnName.trim().toLowerCase()
      );      
      if (shouldHighlight) {
        td.classList.add("highlight");
        document.getElementById("full-highlight-legend-precomputed").style.display = "block";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
  container.appendChild(tableEl);

  if (tableEntityLinkingMap[resultObj.table_id]) {
    const entityStatements = tableEntityLinkingMap[resultObj.table_id][0];
    let entityCoords = [];
    const regex = /#([^#]+);(-?\d+),(-?\d+)#/g;
    entityStatements.forEach(statement => {
      let match;
      while ((match = regex.exec(statement)) !== null) {
        const row = Number(match[2]);
        const col = Number(match[3]);
        entityCoords.push({ row, col });
      }
    });
    const tbody = tableEl.querySelector("tbody");
    if (tbody) {
      Array.from(tbody.rows).forEach((tr, rowIndex) => {
        Array.from(tr.cells).forEach((td, colIndex) => {
          if (entityCoords.some(coord => coord.row === rowIndex && coord.col === colIndex)) {
            td.classList.add("entity-highlight");
          }
        });
      });
    }
    document.getElementById("full-entity-highlight-legend-precomputed").style.display = "block";
  }
}

function updateNativeMetrics() {
  if (!allResults || allResults.length === 0) {
    console.warn("No results available for metrics calculation.");
    return;
  }
  
  let TP = 0, TN = 0, FP = 0, FN = 0;
  
  allResults.forEach(item => {
    if (item.predicted_response === null) return;
    if (item.true_response === 1 && item.predicted_response === 1) {
      TP++;
    } else if (item.true_response === 0 && item.predicted_response === 0) {
      TN++;
    } else if (item.true_response === 0 && item.predicted_response === 1) {
      FP++;
    } else if (item.true_response === 1 && item.predicted_response === 0) {
      FN++;
    }
  });
  
  const matrix = [
    [TN, FP],
    [FN, TP]
  ];
  
  const heatmapData = [{
      z: matrix,
      x: ['Pred. Neg.', 'Pred. Pos.'],
      y: ['Act. Neg.', 'Act. Pos.'],
      type: 'heatmap',
      colorscale: 'Inferno',
      showscale: false
  }];
  
  const heatmapLayout = {
    title: 'Confusion Matrix',
    annotations: [],
    xaxis: { title: 'Predicted' },
    yaxis: { title: 'Actual' }
  };
  
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      heatmapLayout.annotations.push({
        x: heatmapData[0].x[j],
        y: heatmapData[0].y[i],
        text: String(matrix[i][j]),
        showarrow: false,
        font: { color: 'white' }
      });
    }
  }
  
  Plotly.newPlot('confusionMatrixPlot', heatmapData, heatmapLayout);
  
  const precision = (TP + FP) > 0 ? TP / (TP + FP) : 0;
  const recall    = (TP + FN) > 0 ? TP / (TP + FN) : 0;
  const accuracy  = (TP + TN) / (TP + TN + FP + FN);
  const f1        = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  
  const summaryData = [{
    x: ['Accuracy', 'Precision', 'Recall', 'F1 Score'],
    y: [accuracy, precision, recall, f1],
    type: 'bar'
  }];
  
  const summaryLayout = {
    title: 'Performance Summary',
    yaxis: { range: [0, 1], title: 'Score' }
  };
  
  Plotly.newPlot('performanceSummaryPlot', summaryData, summaryLayout);
}

function updateResultsChart(tableId) {
  const resultsHeader = document.getElementById("resultsHeader");
  const chartContainer = document.getElementById("chartContainer");
  if (!resultsHeader) return;
  const results = tableIdToResultsMap[tableId] || [];
  let correctCount = 0;
  let incorrectCount = 0;
  results.forEach(result => {
    if (result.predicted_response === result.true_response) {
      correctCount++;
    } else {
      incorrectCount++;
    }
  });
  if (results.length === 0) {
    resultsHeader.style.display = "none";
    return;
  } else {
    resultsHeader.style.display = "flex";
  }
  const data = {
    labels: ["Correct", "Incorrect"],
    datasets: [{
      label: "Number of Claims",
      data: [correctCount, incorrectCount],
      backgroundColor: ["#4caf50", "#f44336"],
      hoverBackgroundColor: ["#66bb6a", "#ef5350"],
      barThickness: 30
    }]
  };
  const ctx = document.getElementById("resultsChart").getContext("2d");
  if (resultsChartInstance) {
    resultsChartInstance.data = data;
    resultsChartInstance.update();
  } else {
    resultsChartInstance = new Chart(ctx, {
      type: "bar",
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.label}: ${context.parsed.y !== undefined ? context.parsed.y : context.parsed}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }
}

/* LIVE CHECK FUNCTIONS */

async function populateExistingTableDropdown() {
  const existingTableSelect = document.getElementById("existingTableSelect");
  existingTableSelect.innerHTML = `<option value="">-- Select a Table --</option>`;
  try {
    const response = await fetch("https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/data/all_csv_ids.json");
    if (!response.ok) throw new Error(`Failed to fetch all_csv_ids.json: ${response.statusText}`);
    const csvIds = await response.json();
    if (!csvIds || !Array.isArray(csvIds)) throw new Error("Invalid format for all_csv_ids.json.");
    csvIds.sort().forEach(csvFile => {
      const option = document.createElement("option");
      option.value = csvFile;
      let meta = tableToPageMap[csvFile];
      option.textContent = meta ? `${csvFile} - ${meta[0]}` : csvFile;
      existingTableSelect.appendChild(option);
    });
    if (window.existingTableSelectChoices) {
      window.existingTableSelectChoices.destroy();
    }
    window.existingTableSelectChoices = new Choices('#existingTableSelect', {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: false
    });
    existingTableSelect.addEventListener("change", async () => {
      const selectedFile = existingTableSelect.value;
      if (!selectedFile) return;
      await fetchAndFillTable(selectedFile);
      populateClaimsDropdown(selectedFile);
    });
  } catch (error) {
    console.error("Error loading CSV list:", error);
    alert("Failed to fetch available tables. Please try again later.");
  }
}

async function fetchAndFillTable(tableId) {
  const inputTableEl = document.getElementById("inputTable");
  const previewContainer = document.getElementById("livePreviewTable");
  const liveTableMetaInfo = document.getElementById("liveTableMetaInfo");
  const includeTableNameOption = document.getElementById("includeTableNameOption");

  inputTableEl.value = "";
  previewContainer.innerHTML = "";
  if (liveTableMetaInfo) {
    liveTableMetaInfo.style.display = "none";
    liveTableMetaInfo.innerHTML = "";
  }
  includeTableNameOption.style.display = "none";

  const csvUrl = CSV_BASE_PATH + tableId;
  try {
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
    const csvText = await response.text();
    inputTableEl.value = csvText;
    renderLivePreviewTable(csvText, []);
    validateLiveCheckInputs();
    const meta = tableToPageMap[tableId];
    if (meta) {
      const [tableTitle, wikipediaUrl] = meta;
      if (liveTableMetaInfo) {
        liveTableMetaInfo.style.display = "block";
        liveTableMetaInfo.innerHTML = `
          <p><strong>Table Title:</strong> ${tableTitle}</p>
          <p><strong>Wikipedia Link:</strong> <a href="${wikipediaUrl}" target="_blank">${wikipediaUrl}</a></p>
        `;
      }
      includeTableNameOption.style.display = "block";
    }
  } catch (error) {
    console.error("Error loading table CSV:", error);
    alert("Failed to load table from dataset.");
  }
}

function populateClaimsDropdown(tableId) {
  const claimsWrapperEl = document.getElementById("existingClaimsWrapper");
  const claimsSelectEl = document.getElementById("existingClaimsSelect");
  claimsSelectEl.innerHTML = `<option value="">-- Select a Claim --</option>`;
  if (!tableIdToClaimsMap[tableId]) {
    claimsWrapperEl.style.display = "none";
    return;
  }
  const tableData = tableIdToClaimsMap[tableId];
  if (!Array.isArray(tableData) || tableData.length < 2) {
    claimsWrapperEl.style.display = "none";
    return;
  }
  const claimsList = tableData[0];
  const labelsList = tableData[1];
  claimsWrapperEl.style.display = "block";
  claimsList.forEach((claim, idx) => {
    const isCorrect = labelsList[idx] === 1;
    const optionEl = document.createElement("option");
    optionEl.value = idx;
    optionEl.textContent = `Claim #${idx+1} (${isCorrect ? "TRUE" : "FALSE"}) - ${claim.slice(0,60)}...`;
    claimsSelectEl.appendChild(optionEl);
  });
  claimsSelectEl.onchange = function() {
    const selectedIndex = claimsSelectEl.value;
    if (!selectedIndex) return;
    const chosenClaim = claimsList[selectedIndex];
    document.getElementById("inputClaim").value = chosenClaim;
    validateLiveCheckInputs();
  };
}

function validateLiveCheckInputs() {
  const tableInput = document.getElementById("inputTable").value.trim();
  const claimInput = document.getElementById("inputClaim").value.trim();
  const runLiveCheckBtn = document.getElementById("runLiveCheck");
  const stopLiveCheckBtn = document.getElementById("stopLiveCheck");

  if (tableInput && claimInput && window.modelLoaded) {
    runLiveCheckBtn.disabled = false;
    runLiveCheckBtn.style.opacity = "1";
    runLiveCheckBtn.style.cursor = "pointer";
    stopLiveCheckBtn.disabled = false;
    stopLiveCheckBtn.style.opacity = "1";
    stopLiveCheckBtn.style.cursor = "pointer";
  } else {
    runLiveCheckBtn.disabled = true;
    runLiveCheckBtn.style.opacity = "0.6";
    runLiveCheckBtn.style.cursor = "not-allowed";
  }
}

function setupTabSwitching() {
  document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("resultsSection").style.display = "none";
      document.getElementById("liveCheckSection").style.display = "none";
      document.getElementById("reportSection").style.display = "none";
      if (tab.dataset.mode === "precomputed") {
        document.getElementById("resultsSection").style.display = "block";
      } else if (tab.dataset.mode === "live") {
        document.getElementById("liveCheckSection").style.display = "block";
      } else if (tab.dataset.mode === "report") {
        document.getElementById("reportSection").style.display = "block";
        const pdfViewer = document.getElementById("pdfViewer");
        if (!pdfViewer.src || pdfViewer.src === "about:blank") {
          pdfViewer.src = "report.pdf";
        }
      }
    });
  });
}

function setupLiveCheckEvents() {
  // Mark model as loaded.
  window.modelLoaded = true;
  
  // Remove any UI for model loading (if present).

  const inputTableEl = document.getElementById("inputTable");
  const inputClaimEl = document.getElementById("inputClaim");
  const runLiveCheckBtn = document.getElementById("runLiveCheck");

  inputTableEl.addEventListener("input", () => {
    const csvText = inputTableEl.value;
    renderLivePreviewTable(csvText, []);
    validateLiveCheckInputs();
  });

  inputClaimEl.addEventListener("input", () => {
    validateLiveCheckInputs();
  });

  inputClaimEl.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runLiveCheckBtn.click();
    }
  });

  ////////////////////// MAIN FUNCTIONALITY //////////////////////
  // Run Live Check button: call Ollama's completions endpoint with live streaming.
  runLiveCheckBtn.addEventListener("click", async () => {
    runLiveCheckBtn.disabled = true;
    runLiveCheckBtn.style.opacity = "0.6";
    runLiveCheckBtn.style.cursor = "not-allowed";
    document.getElementById("stopLiveCheck").style.display = "inline-block";
    document.getElementById("stopLiveCheck").classList.add("running");

    const tableText = document.getElementById("inputTable").value;
    const claimText = document.getElementById("inputClaim").value;
    // Clear outputs and hide them initially
    liveStreamOutputEl.textContent = "";
    liveThinkOutputEl.textContent = "";
    liveStreamOutputEl.style.display = "none";
    liveStreamOutputEl.classList.add("empty");
    liveThinkOutputEl.style.display = "none";
    liveClaimList.style.display = "none";

    // Added to separate models with different behavior
    let firstThinkTokenReceived = false; 
    let firstNormalTokenReceived = false; 

    const tableMarkdown = csvToMarkdown(tableText);
    const extraInstruction = "\n<think>";
    const prompt = `
You are tasked with determining whether a claim about the following table (in Markdown format) is TRUE or FALSE.
Before giving your final answer, explain your reasoning step-by-step.

#### Table (Markdown):
${tableMarkdown}

#### Claim:
"${claimText}"

Instructions:
After your explanation, output a final answer in valid JSON format:
{"answer": "TRUE" or "FALSE", "relevant_cells": [{"row_index": int, "column_name": "str"}]}
${extraInstruction}
    `.trim();
    
    const selectedModel = document.getElementById("liveModelSelect").value;
    const requestBody = {
      model: selectedModel,
      prompt: prompt,
      max_tokens: 1024,
      stream: true
    };

    // Ollama's API endpoint (see https://github.com/ollama/ollama/blob/main/docs/api.md)
    const url = `${BACKEND_URL}/api/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      globalReader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      // Variables for accumulating text from JSON tokens
      let buffer = "";
      let finalText = "";
      let thinkText = "";
      let inThinkBlock = false;
      
      const startTime = performance.now();
      
      while (true) {
        const { value, done } = await globalReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split buffer by newline - each line should be a complete JSON token.
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep any incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const token = JSON.parse(line);
            let tokenText = token.response;
            // Process tokenText to separate <think> blocks.
            while (true) {
              if (inThinkBlock) {
                const endIdx = tokenText.indexOf("</think>");
                if (endIdx !== -1) {
                  thinkText += tokenText.slice(0, endIdx);
                  tokenText = tokenText.slice(endIdx + 8);
                  inThinkBlock = false;
                  // Continue processing remaining tokenText outside think block.
                  continue;
                } else {
                  thinkText += tokenText;
                  tokenText = "";

                  if (!firstThinkTokenReceived) {
                    liveThinkOutputEl.style.display = "block";
                    liveThinkOutputEl.innerHTML = `
                      <div class="thinking-overlay">
                        <span id="thinkingLabel" class="thinking-label">Thinking...</span>
                        <button id="toggleThinkingBtn" class="toggle-thinking">▲</button>
                      </div>
                      <div id="thinkContent"></div>
                    `;
                    document.getElementById("toggleThinkingBtn").addEventListener("click", function() {
                      const thinkContent = document.getElementById("thinkContent");
                      const liveThinkOutput = document.getElementById("liveThinkOutput");
                      if (thinkContent.style.display === "none") {
                        thinkContent.style.display = "block";
                        liveThinkOutput.classList.remove("collapsed");
                        this.textContent = "▲";
                      } else {
                        thinkContent.style.display = "none";
                        liveThinkOutput.classList.add("collapsed");
                        this.textContent = "▼";
                      }
                    });                    
                    firstThinkTokenReceived = true;
                  }

                  break;
                }
              } else {
                const startIdx = tokenText.indexOf("<think>");
                if (startIdx !== -1) {
                  finalText += tokenText.slice(0, startIdx);
                  tokenText = tokenText.slice(startIdx + 7);
                  inThinkBlock = true;
                  continue;
                } else {
                  finalText += tokenText;

                  if (!firstNormalTokenReceived) {
                    liveStreamOutputEl.style.display = "block";
                    liveStreamOutputEl.innerHTML = `
                      <div class="answer-overlay">
                        <span class="answer-label">Answer</span>
                      </div>
                      <div id="answerContent">${DOMPurify.sanitize(marked.parse(finalText.trim()))}</div>
                    `;
                    firstNormalTokenReceived = true;
                  }
                  
                  break;
                }
              }
            }
            // Update UI live:
            if (firstThinkTokenReceived) {
              const thinkContentDiv = document.getElementById("thinkContent");
              if (thinkContentDiv) {
                thinkContentDiv.innerHTML = DOMPurify.sanitize(marked.parse(thinkText.trim()));
              }
            }
            if (firstNormalTokenReceived) {
              liveStreamOutputEl.innerHTML = `
                <div class="answer-overlay">
                  <span class="answer-label">Answer</span>
                </div>
                <div id="answerContent">${DOMPurify.sanitize(marked.parse(finalText.trim()))}</div>
              `;
            }
  
          } catch (e) {
            console.error("Failed to parse JSON token:", e);
          }
        }
        window.scrollTo(0, document.body.scrollHeight);
      }
      
      // Process any remaining text in the buffer.
      if (buffer.trim()) {
        try {
          const token = JSON.parse(buffer);
          let tokenText = token.response;
          while (true) {
            if (inThinkBlock) {
              const endIdx = tokenText.indexOf("</think>");
              if (endIdx !== -1) {
                thinkText += tokenText.slice(0, endIdx);
                tokenText = tokenText.slice(endIdx + 8);
                inThinkBlock = false;
                continue;
              } else {
                thinkText += tokenText;
                tokenText = "";
                break;
              }
            } else {
              const startIdx = tokenText.indexOf("<think>");
              if (startIdx !== -1) {
                finalText += tokenText.slice(0, startIdx);
                tokenText = tokenText.slice(startIdx + 7);
                inThinkBlock = true;
                continue;
              } else {
                finalText += tokenText;
                break;
              }
            }
          }
        } catch (e) {
          console.error("Error processing final buffer:", e);
        }
      }
      
      const endTime = performance.now();
      if (firstThinkTokenReceived) {
        const thinkingLabel = document.getElementById("thinkingLabel");
        if (thinkingLabel) {
          thinkingLabel.textContent = `Thought for ${((endTime - startTime) / 1000).toFixed(1)}s.`;
          thinkingLabel.classList.add("done");
        }
        liveStreamOutputEl.innerHTML = `
          <div class="answer-overlay">
            <span class="answer-label">Answer</span>
          </div>
          <div id="answerContent">${DOMPurify.sanitize(marked.parse(finalText.trim()))}</div>
        `;
      }
      
      // After streaming, attempt to extract final JSON from the finalText.
      let cleanedResponse = finalText.replace(/```(json)?/gi, "").trim();
      const jsonMatch = cleanedResponse.match(/({[\s\S]*})/);
      let finalOutputHtml = "";
      let parsedJson = {};
      if (jsonMatch) {
        const jsonBlock = jsonMatch[0];
        parsedJson = extractJsonFromResponse(jsonBlock);
        const formattedJson = JSON.stringify(parsedJson, null, 2);
        const jsonFormattedHtml = `
          <div class="json-container small">
            <div class="json-header small">
              <span>JSON</span>
              <button class="copy-btn" onclick="copyToClipboard(this)">
                <img src="images/copy_paste_symbol.svg" alt="copy" class="copy-icon"> Copy
              </button>
            </div>
            <pre class="json-content small"><code class="json hljs">${formattedJson}</code></pre>
          </div>
        `;
        finalOutputHtml = cleanedResponse.replace(jsonBlock, jsonFormattedHtml);
      } else {
        finalOutputHtml = cleanedResponse;
      }
      liveStreamOutputEl.innerHTML = `
        <div class="answer-overlay">
          <span class="answer-label">Answer</span>
        </div>
        ${finalOutputHtml}
      `;
      liveStreamOutputEl.classList.remove("empty");

      document.querySelectorAll('code.json.hljs').forEach(block => hljs.highlightElement(block));


      displayLiveResults(tableText, claimText, parsedJson.answer, parsedJson.relevant_cells);
      
    } catch (err) {
      console.error("Streaming error:", err);
    } finally {
      runLiveCheckBtn.disabled = false;
      runLiveCheckBtn.style.opacity = "1";
      runLiveCheckBtn.style.cursor = "pointer";
      runLiveCheckBtn.innerHTML = "Run Live Check";
      document.getElementById("stopLiveCheck").style.display = "none";
      document.getElementById("stopLiveCheck").classList.remove("running");
    }
  });
  
  const stopLiveCheckBtn = document.getElementById("stopLiveCheck");
  stopLiveCheckBtn.addEventListener("click", () => {
    if (globalReader) {
      globalReader.cancel("User aborted");
      console.log("Generation aborted by user.");
    }
    // Hide the results box and clear its content
    const liveResultsEl = document.getElementById("liveResults");
    liveResultsEl.style.display = "none";
    liveResultsEl.innerHTML = "";
    
    // Show the abort message
    const abortMsgEl = document.getElementById("abortMessage");
    abortMsgEl.style.display = "block";
    abortMsgEl.textContent = "Live check aborted.";
    
    // Reset the run button
    const runLiveCheckBtn = document.getElementById("runLiveCheck");
    runLiveCheckBtn.disabled = false;
    runLiveCheckBtn.style.opacity = "1";
    runLiveCheckBtn.style.cursor = "pointer";
    runLiveCheckBtn.classList.remove("loading");
    runLiveCheckBtn.innerHTML = "Run Live Check";
    
    // Hide the stop button
    stopLiveCheckBtn.style.display = "none";
    stopLiveCheckBtn.classList.remove("running");
  });  
}

function renderLivePreviewTable(csvText, relevantCells) {
  const previewContainer = document.getElementById("livePreviewTable");
  previewContainer.innerHTML = "";
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length) return;
  const tableData = lines.map(line => line.split("#"));
  if (!tableData.length) return;
  const columns = tableData[0];
  const dataRows = tableData.slice(1);
  const tableEl = document.createElement("table");
  tableEl.classList.add("styled-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  tableEl.appendChild(thead);
  const tbody = document.createElement("tbody");
  dataRows.forEach((rowVals, rowIndex) => {
    const tr = document.createElement("tr");
    rowVals.forEach((cellVal, colIndex) => {
      const td = document.createElement("td");
      td.textContent = cellVal;
      const colName = columns[colIndex];
      const shouldHighlight = relevantCells.some(
        hc => hc.row_index === rowIndex &&
              hc.column_name?.toLowerCase() === colName.toLowerCase()
      );
      if (shouldHighlight) td.classList.add("highlight");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);

  const existingTableSelect = document.getElementById("existingTableSelect");
  if (existingTableSelect && existingTableSelect.value && tableEntityLinkingMap[existingTableSelect.value]) {
    const entityStatements = tableEntityLinkingMap[existingTableSelect.value][0];
    let entityCoords = [];
    const regex = /#([^#]+);(-?\d+),(-?\d+)#/g;
    entityStatements.forEach(statement => {
      let match;
      while ((match = regex.exec(statement)) !== null) {
        const row = Number(match[2]);
        const col = Number(match[3]);
        entityCoords.push({ row, col });
      }
    });
    const tbody = tableEl.querySelector("tbody");
    if (tbody) {
      Array.from(tbody.rows).forEach((tr, rowIndex) => {
        Array.from(tr.cells).forEach((td, colIndex) => {
          if (entityCoords.some(coord => coord.row === rowIndex && coord.col === colIndex)) {
            td.classList.add("entity-highlight");
          }
        });
      });
    }
  }

  previewContainer.appendChild(tableEl);

  const legendModel = document.getElementById("full-highlight-legend-live");
  const legendEntity = document.getElementById("full-entity-highlight-legend-live");
  if (tableEl.querySelectorAll("td.highlight").length > 0) {
    legendModel.style.display = "block";
  } else {
    legendModel.style.display = "none";
  }
  if (tableEl.querySelectorAll("td.entity-highlight").length > 0) {
    legendEntity.style.display = "block";
  } else {
    legendEntity.style.display = "none";
  }
}

function displayLiveResults(csvText, claim, answer, relevantCells) {
  document.getElementById("liveResults").style.display = "block";
  const liveClaimList = document.getElementById("liveClaimList");
  liveClaimList.style.display = "block";
  liveClaimList.innerHTML = "";
  const claimDiv = document.createElement("div");
  claimDiv.className = "claim-item selected";
  claimDiv.textContent = `Claim: "${claim}" => Model says: ${answer}`;
  liveClaimList.appendChild(claimDiv);
  renderLivePreviewTable(csvText, relevantCells);
}

function csvToMarkdown(csvStr) {
  const lines = csvStr.trim().split(/\r?\n/);
  if (!lines.length) return "";
  const delimiter = lines[0].indexOf("#") !== -1 ? "#" : ",";
  const tableData = lines.map(line => line.split(delimiter).map(cell => cell.trim()));
  if (!tableData.length) return "";
  const headers = tableData[0];
  const rows = tableData.slice(1);
  let md = `| ${headers.join(" | ")} |\n`;
  md += `| ${headers.map(() => "---").join(" | ")} |\n`;
  rows.forEach(row => {
    md += `| ${row.join(" | ")} |\n`;
  });
  return md;
}

function csvToJson(csvStr) {
  const lines = csvStr.trim().split(/\r?\n/);
  if (!lines.length) return "{}";
  const delimiter = lines[0].indexOf("#") !== -1 ? "#" : ",";
  const headers = lines[0].split(delimiter).map(cell => cell.trim());
  const rows = lines.slice(1).map(line => line.split(delimiter).map(cell => cell.trim()));
  return JSON.stringify({ columns: headers, data: rows }, null, 2);
}

function extractJsonFromResponse(rawResponse) {
  let jsonText = rawResponse.trim();
  const fencePattern = /```json\s*([\s\S]*?)\s*```/i;
  const fenceMatch = jsonText.match(fencePattern);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  } else {
    const braceMatch = jsonText.match(/{.*}/s);
    if (braceMatch) {
      jsonText = braceMatch[0];
    } else {
      jsonText = rawResponse.trim();
    }
  }
  jsonText = jsonText.replace(/,\s*([\]}])/g, '$1');
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed.answer || !parsed.relevant_cells) {
      throw new Error("Missing 'answer' or 'relevant_cells' key");
    }
    return parsed;
  } catch (err) {
    console.warn("JSON parsing error:", err);
    const lowerResponse = rawResponse.toLowerCase();
    if (lowerResponse.includes("true")) {
      return { answer: "TRUE", relevant_cells: [] };
    } else if (lowerResponse.includes("false")) {
      return { answer: "FALSE", relevant_cells: [] };
    } else {
      return { answer: "FALSE", relevant_cells: [] };
    }
  }
}

function separateThinkFromResponse(rawText) {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
  const match = rawText.match(thinkRegex);
  let thinkContent = "";
  let remainder = rawText;
  if (match) {
    thinkContent = match[1].trim();
    remainder = rawText.replace(thinkRegex, "").trim();
  }
  return { think: thinkContent, noThink: remainder };
}

function copyToClipboard(btn) {
  // Find the <code> element in the sibling .json-content container.
  const codeBlock = btn.parentNode.nextElementSibling.querySelector('code');
  const codeText = codeBlock.textContent;

  navigator.clipboard.writeText(codeText)
    .then(() => {
      btn.innerHTML = `<img src="images/copy_paste_symbol.svg" alt="copy" class="copy-icon"> Copied!`;
      setTimeout(() => { 
        btn.innerHTML = `<img src="images/copy_paste_symbol.svg" alt="copy" class="copy-icon"> Copy`;
      }, 1500);
    })
    .catch(err => {
      console.error("Failed to copy: ", err);
      alert("Failed to copy code.");
    });
}
