//
// app.js
//

// CONSTANTS for paths
const CSV_BASE_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/data/all_csv/";
const ALL_CSV_IDS_PATH = "https://raw.githubusercontent.com/wenhuchen/Table-Fact-Checking/refs/heads/master/data/all_csv_ids.json";
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
let selectedTableId = null;
let resultsChartInstance = null;
let manifestOptions = []; // Array of manifest options for filtering

// DOM element references
const modelLoadingStatusEl = document.getElementById("modelLoadingStatus");
const liveThinkOutputEl = document.getElementById("liveThinkOutput");
const liveStreamOutputEl = document.getElementById("liveStreamOutput");
const liveClaimListEl = document.getElementById("liveClaimList");

window.modelLoaded = true;
let globalReader = null;
let globalCSVId = null;

// Disable auto-scroll if the user scrolls up manually.
let autoScrollEnabled = true;
let lastScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
let autoScrollTimeout;

window.addEventListener("scroll", function() {
  const currentScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
  // If the user scrolled up more than 20px compared to the last position:
  if (currentScrollPosition < lastScrollPosition - 20) {
    autoScrollEnabled = false;
    clearTimeout(autoScrollTimeout);
    autoScrollTimeout = setTimeout(() => {
      autoScrollEnabled = true;
    }, 5000); // Re-enable auto-scroll after 5 seconds of no upward scrolling.
  }
  lastScrollPosition = currentScrollPosition;
});


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

    // Language selection
    const languageSelect = document.getElementById("liveLanguageSelect");
    if (languageSelect) {
      languageSelect.addEventListener("change", () => {
        updateModelOptionsBasedOnLanguage();
        updateTranslations();
        if (globalCSVId) {
          populateClaimsDropdown(globalCSVId);
        }
        if (document.getElementById("tableTitleLabel")) {
          document.getElementById("tableTitleLabel").textContent = translationDict[languageSelect.value].table_title;
        }
      });
      // Initial call
      updateModelOptionsBasedOnLanguage();
      updateTranslations();
    }

    // Handle paste events in the table textarea to detect images.
    const inputTableEl = document.getElementById("inputTable");
    inputTableEl.addEventListener("paste", function (e) {
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          // Show loading spinner/modal.
          const loadingModal = document.getElementById("loadingModal");
          loadingModal.style.display = "flex";
          // Show image preview
          const imagePreview = document.getElementById("imagePreview");
          const url = URL.createObjectURL(file);
          imagePreview.innerHTML = `<span class="close-preview">&times;</span><img src="${url}" alt="Pasted Image Preview">`;
          imagePreview.style.display = "block";
          
          processImageOCR(file)
            .then(csvText => {
              loadingModal.style.display = "none";
              inputTableEl.value = csvText;
              renderLivePreviewTable(csvText, []);
              validateLiveCheckInputs();
            })
            .catch(err => {
              loadingModal.style.display = "none";
              console.error("OCR processing error on paste:", err);
              alert("Failed to process the pasted image. Please try again.");
            });
          // Prevent the default paste action.
          e.preventDefault();
          return;
        }
        else if (items[i].type === "text/plain") {
          return;
        }
      }
    });
    // remove image preview when clicking the close button.
    const imagePreviewEl = document.getElementById("imagePreview");
    imagePreviewEl.addEventListener("click", function (e) {
      if (e.target.classList.contains("close-preview")) {
        imagePreviewEl.style.display = "none";
        imagePreviewEl.querySelectorAll("img").forEach(img => img.remove());
      }
    });



    document.querySelectorAll("textarea").forEach(textarea => {
      textarea.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
      });
    });
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

    // change first part of wikipedia url to reflect the selected language
    const lang = document.getElementById("liveLanguageSelect").value;
    const langCode = lang === "en" ? "" : lang + ".";
    const newWikipediaUrl = wikipediaUrl.replace(/https:\/\/en\./, `https://${langCode}`);

    tableTitleLabel = translationDict[lang] ? translationDict[lang].table_title : "Table Title";

    metaDiv.innerHTML = `
      <p><strong id="tableTitleLabel">${tableTitleLabel}</strong> ${tableTitle}</p>
      <p><strong>Wikipedia Link:</strong> <a href="${newWikipediaUrl}" data-wikipedia-preview target="_blank">${newWikipediaUrl}</a></p>
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

// + BUTTON OPTIONS

// Toggle the options dropdown when clicking the + button (unchanged)
document.getElementById("tableOptionsBtn").addEventListener("click", function (e) {
  e.stopPropagation();
  const dropdown = document.getElementById("tableOptionsDropdown");
  dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
});

// Hide the dropdown when clicking outside the dropdown
document.addEventListener("click", function (e) {
  const dropdown = document.getElementById("tableOptionsDropdown");
  if (!dropdown.contains(e.target)) {
    dropdown.style.display = "none";
  }
});

// For the "Choose from TabFact Dataset" button, open a modal with an overview of tables.
document.getElementById("selectFromDatasetBtn").addEventListener("click", async function () {
  document.getElementById("tableOptionsDropdown").style.display = "none";
  openDatasetOverviewModal();
});

// For the "Upload CSV File" button, trigger a click on the hidden file input.
document.getElementById("uploadCSVBtn").addEventListener("click", function () {
  document.getElementById("tableOptionsDropdown").style.display = "none";
  const fileInput = document.getElementById("fileUpload");
  if (fileInput) {
    fileInput.click();
  } else {
    alert("File upload is not available.");
  }
});

// Function to open the dataset overview modal.
async function openDatasetOverviewModal() {
  const modal = document.getElementById("datasetOverviewModal");
  const datasetList = document.getElementById("datasetList");
  // Show a loading message (will be replaced after fetch)
  // Loading tables...
  // Choose text from translationDict based on the selected language
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];
  datasetList.innerHTML = `<p class="dataset-loading-message">${translation.loading_Message}</p>`;
  modal.style.display = "flex";
  
  try {
    const response = await fetch(ALL_CSV_IDS_PATH);
    if (!response.ok) {
      throw new Error("Failed to load dataset list: " + response.statusText);
    }
    const csvIds = await response.json();
    if (!Array.isArray(csvIds)) {
      throw new Error("Dataset list is not an array");
    }
    // Update loading message to show the number of tables loaded
    datasetList.innerHTML = `<p class="dataset-loading-message">${csvIds.length} ${translation.tables_loaded}.</p>`;
    
    csvIds.sort().forEach((csvId, index) => {
      const item = document.createElement("div");
      item.classList.add("dataset-item");
      let title = "No title";
      let wiki = "";
      if (tableToPageMap && tableToPageMap[csvId]) {
        title = tableToPageMap[csvId][0] || title;
        wiki = tableToPageMap[csvId][1] || "";
      }
      // Capitalize title nicely
      title = title.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

      // change first part of wikipedia url to reflect the selected language
      const langCode = lang === "en" ? "" : lang + ".";
      const newWikipediaUrl = wiki.replace(/https:\/\/en\./, `https://${langCode}`);
      
      // Build the dataset item HTML with enumeration and a subtle wiki link if available
      item.innerHTML = `
        <div class="dataset-item-header">
          <span class="dataset-item-number">${index + 1}.</span>
          <span class="dataset-item-title"><strong>${title}</strong> (${csvId})</span>
          ${wiki ? `<a class="dataset-item-wiki-link" href="${newWikipediaUrl}" target="_blank" data-wikipedia-preview data-wp-title="${title}" data-wp-lang="${lang}"><img src="images/wiki.svg" alt="Wikipedia" class="wiki-icon"></a>` : ''}
        </div>
      `;
      
      // When clicking the item, load the table into the live area.
      item.addEventListener("click", async function(e) {
        await fetchAndFillTable(csvId);
        populateClaimsDropdown(csvId);
        modal.style.display = "none";
        globalCSVId = csvId;
      });
      
      datasetList.appendChild(item);
    });
    
    // Initialize Wikipedia previews on the modal’s new content.
    wikipediaPreview.init({ root: document.getElementById("datasetOverviewModal") });
    
  } catch (err) {
    datasetList.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
    console.error("Error in dataset modal:", err);
  }
}


// Close the dataset modal when clicking outside its content.
document.getElementById("datasetOverviewModal").addEventListener("click", function(e) {
  if (e.target === this) {
    this.style.display = "none";
  }
});

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

      // change first part of wikipedia url to reflect the selected language
      const lang = document.getElementById("liveLanguageSelect").value;
      const langCode = lang === "en" ? "" : lang + ".";
      const newWikipediaUrl = wikipediaUrl.replace(/https:\/\/en\./, `https://${langCode}`);

      tableTitleLabel = translationDict[lang] ? translationDict[lang].table_title : "Table Title";

      if (liveTableMetaInfo) {
        liveTableMetaInfo.style.display = "block";
        liveTableMetaInfo.innerHTML = `
          <div class="meta-info-box">
            <p><strong id="tableTitleLabel">${tableTitleLabel}</strong> ${tableTitle}</p>
            <p><strong>Wikipedia Link:</strong> 
              <a href="${newWikipediaUrl}" data-wikipedia-preview data-wp-title="${tableTitle}" data-wp-lang="${lang}" target="_blank">
                ${newWikipediaUrl}
              </a>
            </p>
          </div>
        `;
        // Initialize Wikipedia preview for the meta info area.
        wikipediaPreview.init({ root: liveTableMetaInfo });
      }
      includeTableNameOption.style.display = "block";
    }
    inputTableEl.style.height = "auto";
  } catch (error) {
    console.error("Error loading table CSV:", error);
    alert("Failed to load table from dataset.");
  }
}


function populateClaimsDropdown(tableId) {
  const claimsWrapperEl = document.getElementById("existingClaimsWrapper");
  const claimsSelectEl = document.getElementById("existingClaimsSelect");

  // first option according to language (e.g. Select a Claim in English)
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];
  const selectClaimPlaceholder = translation.selectClaimPlaceholder;

  claimsSelectEl.innerHTML = `<option value="">-- ${selectClaimPlaceholder}  --</option>`;
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
    document.getElementById("abortMessage").style.display = "none";
    window.streamAborted = false;

    const selectedLanguage = document.getElementById("liveLanguageSelect").value;
    const translation = window.translationDict[selectedLanguage] || window.translationDict["en"];
    let requestStatus = document.getElementById("requestStatus");
    if (!requestStatus) {
      requestStatus = document.createElement("p");
      requestStatus.id = "requestStatus";
      requestStatus.className = "status-message";
      document.getElementById("liveCheckSection").insertBefore(requestStatus, document.getElementById("liveResults"));
    }
    let queuedTimer = setTimeout(() => {
      requestStatus.style.display = "block";
      requestStatus.textContent = translation.queuedMessage;
    }, 2000);
  
    const liveResultsEl = document.getElementById("liveResults");
    const liveClaimList = document.getElementById("liveClaimList");
  
    // Clear previous outputs
    liveStreamOutputEl.textContent = "";
    liveThinkOutputEl.textContent = "";
    liveStreamOutputEl.style.display = "none";
    liveThinkOutputEl.style.display = "none";
    liveClaimList.style.display = "none";
    liveResultsEl.style.display = "none";
  
    let firstThinkTokenReceived = false;
    let firstAnswerTokenReceived = false;
    let finalText = "";
    let thinkText = "";
    let inThinkBlock = false;
    let buffer = "";
  
    const tableText = document.getElementById("inputTable").value;
    const claimText = document.getElementById("inputClaim").value;
    const includeTitle = document.getElementById("includeTableNameCheck").checked;
    let tableTitleText = "";
    if (includeTitle && selectedTableId && tableToPageMap[selectedTableId]) {
      tableTitleText = tableToPageMap[selectedTableId][0];
    }
  
    const tableMarkdown = csvToMarkdown(tableText);
  
    // Build prompt
    let prompt = `
      You are tasked with determining whether a claim about the following table is TRUE or FALSE.
    `;
    if (tableTitleText) {
      prompt += `\nTable Title: "${tableTitleText}"\n`;
    }
    prompt += `
      #### Table (Markdown):
      ${tableMarkdown}
  
      #### Claim:
      "${claimText}"
  
      Instructions:
      After your explanation, output a final answer in valid JSON format:
      {"answer": "TRUE" or "FALSE", "relevant_cells": [{"row_index": int, "column_name": "str"}]}
  
      Please consider the header of the table as row_index=0.
    `;
    const selectedModel = document.getElementById("liveModelSelect").value;
    let extraInstruction = "";
    if (selectedLanguage === "en") {
      if (selectedModel.toLowerCase().includes("deepseek")) {
        extraInstruction = "\n<think>";
      }
    } else if (selectedLanguage === "fr") {
      extraInstruction = "\nPlease provide your response in French.";
    } else if (selectedLanguage === "de") {
      extraInstruction = "\nPlease provide your response in German.";
    }
    prompt += extraInstruction;
    prompt = prompt.trim();
    prompt += extraInstruction;
    prompt = prompt.trim();
  
    const requestBody = {
      model: selectedModel,
      prompt: prompt,
      max_tokens: 2048,
      stream: true,
      keep_alive: 0 // unload models immediately to free up GPU, might need to adjust this value
    };
  
    // Ollama's API endpoint (see https://github.com/ollama/ollama/blob/main/docs/api.md)
    const url = `${BACKEND_URL}/api/generate`; // or without the backend url if using a proxy

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      document.getElementById("stopLiveCheck").style.display = "inline-block";
      document.getElementById("stopLiveCheck").classList.add("running");

      globalReader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      const startTime = performance.now();
  
      while (true) {
        const { value, done } = await globalReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // retain incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const token = JSON.parse(line);
            let tokenText = token.response;

            if (queuedTimer) {
              clearTimeout(queuedTimer);
              queuedTimer = null;
              requestStatus.style.display = "none";
            }

            // Process tokenText to separate <think> blocks from answer tokens.
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
                  // On first receipt, render thinking block with toggle button.
                  if (!firstThinkTokenReceived) {
                    liveThinkOutputEl.style.display = "block";
                    liveThinkOutputEl.innerHTML = `
                      <div class="thinking-overlay">
                        <span id="thinkingLabel" class="thinking-label">Thinking...</span>
                        <button id="toggleThinkingBtn" class="toggle-btn">▲</button>
                      </div>
                      <div id="thinkContent" class="collapsible">${DOMPurify.sanitize(marked.parse(thinkText.trim()))}</div>
                    `;
                    document.getElementById("toggleThinkingBtn").addEventListener("click", function() {
                      const content = document.getElementById("thinkContent");
                      if (content.classList.contains("collapsed")) {
                        content.classList.remove("collapsed");
                        this.textContent = "▲";
                      } else {
                        content.classList.add("collapsed");
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
                  if (!firstAnswerTokenReceived) {
                    liveStreamOutputEl.style.display = "block";
                    liveStreamOutputEl.innerHTML = `
                      <div class="answer-overlay">
                        <span id="answer-label">${translation.answerLabel}</span>
                        <button id="toggleAnswerBtn" class="toggle-btn">▲</button>
                      </div>
                      <div id="answerContent" class="collapsible">${DOMPurify.sanitize(marked.parse(finalText.trim()))}</div>
                    `;
                    document.getElementById("toggleAnswerBtn").addEventListener("click", function() {
                      const content = document.getElementById("answerContent");
                      if (content.classList.contains("collapsed")) {
                        content.classList.remove("collapsed");
                        this.textContent = "▲";
                      } else {
                        content.classList.add("collapsed");
                        this.textContent = "▼";
                      }
                    });
                    firstAnswerTokenReceived = true;
                  }
                  break;
                }
              }
            }
            // Update thinking block
            if (firstThinkTokenReceived) {
              const thinkContentDiv = document.getElementById("thinkContent");
              if (thinkContentDiv) {
                thinkContentDiv.innerHTML = DOMPurify.sanitize(marked.parse(thinkText.trim()));
              }
            }
            // Update answer block
            if (firstAnswerTokenReceived) {
              const answerContentDiv = document.getElementById("answerContent");
              if (answerContentDiv) {
                answerContentDiv.innerHTML = DOMPurify.sanitize(marked.parse(finalText.trim()));
              }
            }
          } catch (e) {
            console.error("Failed to parse JSON token:", e);
          }
        }
        if (autoScrollEnabled) {
          window.scrollTo(0, document.body.scrollHeight);
        }
      }
      // Process any remaining buffer
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
        // Final update to the answer block.
        liveStreamOutputEl.innerHTML = `
          <div class="answer-overlay">
            <span id="answer-label">${translation.answerLabel}</span>
            <button id="toggleAnswerBtn" class="toggle-btn">▲</button>
          </div>
          <div id="answerContent" class="collapsible">${DOMPurify.sanitize(marked.parse(finalText.trim()))}</div>
        `;
        // Re-attach the answer toggle listener to the new button.
        const finalToggleAnswerBtn = document.getElementById("toggleAnswerBtn");
        finalToggleAnswerBtn.addEventListener("click", function() {
          const content = document.getElementById("answerContent");
          if (content.classList.contains("collapsed")) {
            content.classList.remove("collapsed");
            this.textContent = "▲";
          } else {
            content.classList.add("collapsed");
            this.textContent = "▼";
          }
        });
      }

      if (window.streamAborted) {
        // Abort was triggered so do not update results.
        return;
      }
    
      // Extract final JSON and render it (same as before)
      let cleanedResponse = finalText.replace(/```(json)?/gi, "").trim();
      const jsonMatch = cleanedResponse.match(/({[\s\S]*})/);
      let finalOutputHtml = "";
      let parsedJson = {};
      if (jsonMatch) {
        const jsonBlock = jsonMatch[0];
        parsedJson = extractJsonFromResponse(jsonBlock);
        const formattedJson = JSON.stringify(parsedJson, null, 2);
        const jsonContainerHtml = `
          <div class="json-container">
            <div class="json-header">
              <span>JSON</span>
              <button class="copy-btn" onclick="copyToClipboard(this)">
                <img src="images/copy_paste_symbol.svg" alt="copy" class="copy-icon"> Copy
              </button>
            </div>
            <pre class="json-content"><code class="json hljs">${formattedJson}</code></pre>
          </div>
        `;
        const markdownPart = cleanedResponse.replace(jsonBlock, "").trim();
        const markdownHtml = DOMPurify.sanitize(marked.parse(markdownPart));
        finalOutputHtml = markdownHtml + jsonContainerHtml;
      } else {
        finalOutputHtml = DOMPurify.sanitize(marked.parse(cleanedResponse));
      }
    
      // Update answer block with final output (JSON remains as before)
      liveStreamOutputEl.innerHTML = `
        <div class="answer-overlay">
          <span id="answer-label">${translation.answerLabel}</span>
          <button id="toggleAnswerBtn" class="toggle-btn">▲</button>
        </div>
        <div id="answerContent" class="collapsible">${finalOutputHtml}</div>
      `;
      // Attach the answer toggle listener one last time.
      const finalAnswerToggleBtn = document.getElementById("toggleAnswerBtn");
      finalAnswerToggleBtn.addEventListener("click", function() {
        const content = document.getElementById("answerContent");
        if (content.classList.contains("collapsed")) {
          content.classList.remove("collapsed");
          this.textContent = "▲";
        } else {
          content.classList.add("collapsed");
          this.textContent = "▼";
        }
      });
      liveResultsEl.style.display = "block";
      document.querySelectorAll('code.json.hljs').forEach(block => hljs.highlightElement(block));
      displayLiveResults(tableText, claimText, parsedJson.answer, parsedJson.relevant_cells);
    
      // Automatically collapse both the thinking and answer sections after 2 seconds.
      setTimeout(() => {
        const thinkContent = document.getElementById("thinkContent");
        const answerContent = document.getElementById("answerContent");
        if (thinkContent && !thinkContent.classList.contains("collapsed")) {
          thinkContent.classList.add("collapsed");
          const toggleThinkingBtn = document.getElementById("toggleThinkingBtn");
          if (toggleThinkingBtn) toggleThinkingBtn.textContent = "▼";
        }
        if (answerContent && !answerContent.classList.contains("collapsed")) {
          answerContent.classList.add("collapsed");
          const toggleAnswerBtn = document.getElementById("toggleAnswerBtn");
          if (toggleAnswerBtn) toggleAnswerBtn.textContent = "▼";
        }
      }, 0);
    
    } catch (err) {
      console.error("Streaming error:", err);
      if (requestStatus) {
        requestStatus.innerHTML = `<span>${translation.networkError} ${err.message}</span> <button id="retryBtn" class="btn-primary">${translation.retryBtn}</button>`;
        document.getElementById("retryBtn").addEventListener("click", () => {
          requestStatus.style.display = "none";
          // Trigger the run live check event again
          runLiveCheckBtn.click();
        });
      }
    } finally {
      if (requestStatus) {
        requestStatus.style.display = "none";
      }
      runLiveCheckBtn.disabled = false;
      runLiveCheckBtn.style.opacity = "1";
      runLiveCheckBtn.style.cursor = "pointer";
      runLiveCheckBtn.innerHTML = translation.runLiveCheckBtn;
      document.getElementById("stopLiveCheck").style.display = "none";
      document.getElementById("stopLiveCheck").classList.remove("running");
    }
  });
  
  
  
  const stopLiveCheckBtn = document.getElementById("stopLiveCheck");
  stopLiveCheckBtn.addEventListener("click", () => {
    // Set abort flag
    window.streamAborted = true;
    if (globalReader) {
      globalReader.cancel("User aborted");
      console.log("Generation aborted by user.");
    }
    // Hide the results box and clear its content
    const liveResultsEl = document.getElementById("liveResults");
    liveResultsEl.style.display = "none";
    
    // Show the abort message
    const abortMsgEl = document.getElementById("abortMessage");
    abortMsgEl.style.display = "block";
    const lang = document.getElementById("liveLanguageSelect").value;
    const translation = window.translationDict[lang] || window.translationDict["en"];
    abortMsgEl.textContent = translation.abortMessage;
    
    // Reset the run button
    const runLiveCheckBtn = document.getElementById("runLiveCheck");
    runLiveCheckBtn.disabled = false;
    runLiveCheckBtn.style.opacity = "1";
    runLiveCheckBtn.style.cursor = "pointer";
    runLiveCheckBtn.classList.remove("loading");
    runLiveCheckBtn.innerHTML = translation.runLiveCheckBtn;
    
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
    
      // Use optional chaining to avoid errors
      const colName = columns[colIndex];
      const colNameLower = colName?.toLowerCase();
    
      const shouldHighlight = relevantCells.some(
        hc => hc.row_index === rowIndex &&
              hc.column_name?.toLowerCase() === colNameLower
      );
      if (shouldHighlight) td.classList.add("highlight");
    
      tr.appendChild(td);
    });    
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);

  let tableKey = selectedTableId;

  if (tableKey && tableEntityLinkingMap && tableEntityLinkingMap[tableKey]) {
    const entityStatements = tableEntityLinkingMap[tableKey][0];
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
    if (tbody) {
      Array.from(tbody.rows).forEach((tr, rowIndex) => {
        Array.from(tr.cells).forEach((td, colIndex) => {
          if (entityCoords.some(coord => coord.row === rowIndex && coord.col === colIndex)) {
            td.classList.add("entity-highlight");
          }
        });
      });
    }
    // Ensure the entity highlight legend is visible.
    document.getElementById("full-entity-highlight-legend-live").style.display = "block";
  } else {
    document.getElementById("full-entity-highlight-legend-live").style.display = "none";
  }

  previewContainer.appendChild(tableEl);

  const legendModel = document.getElementById("full-highlight-legend-live");
  if (tableEl.querySelectorAll("td.highlight").length > 0) {
    legendModel.style.display = "block";
  } else {
    legendModel.style.display = "none";
  }
}


function displayLiveResults(csvText, claim, answer, relevantCells) {
  const liveResultsEl = document.getElementById("liveResults");
  if (liveResultsEl) {
    liveResultsEl.style.display = "block";
  }
  const liveClaimList = document.getElementById("liveClaimList");
  if (liveClaimList) {
    liveClaimList.style.display = "block";
    liveClaimList.innerHTML = "";
    // Display the claim text in quotes without any prefix
    const claimDisplay = document.createElement("div");
    claimDisplay.className = "claim-display";
    claimDisplay.textContent = `"${claim}"`;
    liveClaimList.appendChild(claimDisplay);
    // Display final verdict in a styled box
    const verdictDiv = document.createElement("div");
    verdictDiv.className = "final-verdict " + (answer === "TRUE" ? "true" : "false");

    const lang = document.getElementById("liveLanguageSelect").value;
    const translation = translationDict[lang] || translationDict["en"];
    const verdictText = answer === "TRUE" ? translation.trueLabel : translation.falseLabel;
    verdictDiv.textContent = verdictText.toUpperCase();
    liveClaimList.appendChild(verdictDiv);
  }

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
  // Find the first '{' character.
  let start = rawResponse.indexOf("{");
  if (start === -1) return null;
  let braceCount = 0;
  let end = -1;
  // Scan from the first '{' and count opening and closing braces.
  for (let i = start; i < rawResponse.length; i++) {
    if (rawResponse[i] === "{") {
      braceCount++;
    } else if (rawResponse[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const jsonText = rawResponse.substring(start, end + 1);
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed.answer || !("relevant_cells" in parsed)) {
      throw new Error("Missing required keys");
    }
    return parsed;
  } catch (err) {
    console.warn("JSON parsing error:", err);
    // Fallback: if response contains "true"/"false", return default object.
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

function updateModelOptionsBasedOnLanguage() {
  const languageSelect = document.getElementById("liveLanguageSelect");
  const selectedLanguage = languageSelect.value;
  const modelSelect = document.getElementById("liveModelSelect");
  const allowedModels = ["llama3.2", "gemma3"];

  // Loop over model options and disable ones that are not allowed in non-English mode.
  for (const option of modelSelect.options) {
    if (selectedLanguage !== "en") {
      option.disabled = !allowedModels.includes(option.value);
    } else {
      option.disabled = false;
    }
  }
  // If the current selected model is now disabled, switch to the first allowed one.
  if (modelSelect.selectedOptions.length > 0) {
    const selectedOption = modelSelect.selectedOptions[0];
    if (selectedOption.disabled) {
      for (const option of modelSelect.options) {
        if (!option.disabled) {
          modelSelect.value = option.value;
          break;
        }
      }
    }
  }
}



// Event listener for image upload button
document.getElementById("uploadImageBtn").addEventListener("click", function() {
  document.getElementById("imageUpload").click();
});

// When an image is selected, process it using the chosen OCR engine
document.getElementById("imageUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (file) {
    const loadingModal = document.getElementById("loadingModal");
    loadingModal.style.display = "flex"; // Show modal

    // Show image preview for the uploaded image
    const imagePreview = document.getElementById("imagePreview");
    const url = URL.createObjectURL(file);
    imagePreview.innerHTML = `<span class="close-preview">&times;</span><img src="${url}" alt="Image Preview">`;
    imagePreview.style.display = "block";

    processImageOCR(file)
      .then(csvText => {
        loadingModal.style.display = "none"; // Hide modal when done
        const inputTableEl = document.getElementById("inputTable");
        inputTableEl.value = csvText;
        renderLivePreviewTable(csvText, []);
        validateLiveCheckInputs();
      })
      .catch(err => {
        loadingModal.style.display = "none";
        console.error("OCR processing error:", err);
        alert("Failed to process the image. Please try again.");
      })
      .finally(() => {
        e.target.value = "";
      });
  }
});




// Main function to select the OCR engine based on user selection
function processImageOCR(file) {
  const engine = document.getElementById('ocrEngineSelect').value;
  if (engine === 'tesseract') {
    return processImageWithTesseract(file);
  } else if (engine === 'ollama') {
    return processImageWithOllama(file);
  } else {
    return Promise.reject(new Error("Unknown OCR engine selected."));
  }
}

// Option 1: Client-side OCR using Tesseract.js
function processImageWithTesseract(file) {
  return Tesseract.recognize(file, 'eng', { logger: m => console.log(m) })
    .then(({ data: { text } }) => {
      // Convert the OCR text to CSV format with '#' as delimiter.
      return processOCRTextToCSV(text);
    });
}

// Option 2: Server-side OCR using Ollama granite3.2-vision
function processImageWithOllama(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUrl = e.target.result; // e.g. "data:image/png;base64,ABC..."
      // Remove the prefix so only the base64 string remains.
      const base64String = dataUrl.split(",")[1];
      
      const payload = {
        model: "granite3.2-vision", 
        prompt: "Return only the table extracted from the image as #-separated values! Do not include row numbers or any additional text. Preserve any commas that appear in numbers. DO NOT USE A COMMA AS A DELIMITER.",
        images: [base64String],
        stream: false,
        keep_alive: 0
      };
      fetch(BACKEND_URL + '/api/generate', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error("Ollama OCR failed: " + response.statusText);
        }
        return response.json(); // Expect a JSON response.
      })
      .then(data => {
        if (data && data.response) {
          // Process the CSV: remove row numbers, quotes, and convert delimiter from comma to "#"
          let csvText = processOllamaCSV(data.response);
          resolve(csvText);
        } else {
          reject(new Error("Ollama OCR returned unexpected response format."));
        }
      })
      .catch(err => {
        reject(err);
      });
    };
    reader.onerror = function(err) {
      reject(err);
    };
    reader.readAsDataURL(file);
  });
}


// Improved helper function to convert raw OCR text to CSV format using '#' as delimiter.
// It merges a split header (if the second line is very short) and then merges lines that have too few tokens.
function processOCRTextToCSV(ocrText) {
  let lines = ocrText.split(/\r?\n/).filter(line => line.trim().length > 0);
  
  // Replace multiple spaces or tabs with '#' in each line.
  lines = lines.map(line => line.trim().replace(/[\s\t]+/g, "#"));

  // If the first line (header) is followed by a very short line, merge it.
  if (lines.length > 1) {
    const headerTokens = lines[0].split("#");
    const secondTokens = lines[1].split("#");
    if (secondTokens.length < 3) { // heuristic: if second line is very short
      headerTokens[headerTokens.length - 1] = headerTokens[headerTokens.length - 1] + " " + secondTokens.join(" ");
      lines[0] = headerTokens.join("#");
      lines.splice(1, 1);
    }
  }

  if (lines.length === 0) {
    return "";
  }
  
  // Determine expected column count from header.
  const expectedColumns = lines[0].split("#").length;
  let processedLines = [lines[0]];
  let buffer = "";

  // Process remaining lines. If a line has fewer tokens than expected, merge it with the buffer.
  for (let i = 1; i < lines.length; i++) {
    let currentLine = lines[i];
    const cols = currentLine.split("#");
    if (cols.length < expectedColumns) {
      buffer += (buffer ? " " : "") + currentLine;
      if (buffer.split("#").length >= expectedColumns) {
        processedLines.push(buffer);
        buffer = "";
      }
    } else {
      if (buffer) {
        currentLine = buffer + " " + currentLine;
        buffer = "";
      }
      processedLines.push(currentLine);
    }
  }
  if (buffer) {
    processedLines.push(buffer);
  }
  return processedLines.join("\n");
}

function processOllamaCSV(csvText) {
  // Remove any extraneous quotes.
  csvText = csvText.replace(/"/g, '');

  // Define a placeholder for thousand-separator commas.
  const placeholder = 'THOUSANDSSEP';

  // Helper: protect commas used as thousand separators.
  function protectThousandSeparators(text) {
    let newText = text;
    const regex = /(\d),(\d{3})(?!\d)/g;
    // Loop in case there are multiple commas (e.g., "1,234,567")
    while (regex.test(newText)) {
      newText = newText.replace(regex, '$1' + placeholder + '$2');
    }
    return newText;
  }
  csvText = protectThousandSeparators(csvText);

  // Split the text into lines.
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');

  // Process each line.
  const processedLines = lines.map(line => {
    let cells = line.split(',').map(cell => cell.trim());
    // Remove an empty first cell if it exists.
    if (cells[0] === '') {
      cells.shift();
    }
    return cells.join('#');
  });

  let result = processedLines.join('\n');

  // Restore thousand separators.
  result = result.replace(new RegExp(placeholder, 'g'), ',');

  return result;
}




function updateTranslations() {
  const lang = document.getElementById("liveLanguageSelect").value;
  
  // Table Section
  const tableHeading = document.querySelector(".table-input-group h3");
  if (tableHeading) tableHeading.textContent = translationDict[lang].enterTable;

  const inputTablePlaceholder = document.getElementById("inputTable");
  if (inputTablePlaceholder) inputTablePlaceholder.placeholder = translationDict[lang].inputTablePlaceholder;

  const selectFromDatasetBtn = document.getElementById("selectFromDatasetBtn");
  if (selectFromDatasetBtn) selectFromDatasetBtn.textContent = translationDict[lang].selectFromDatasetBtn;

  const uploadCSVBtn = document.getElementById("uploadCSVBtn");
  if (uploadCSVBtn) uploadCSVBtn.textContent = translationDict[lang].uploadCSVBtn;

  const datasetModalHeader = document.querySelector(".dataset-modal-content h3");
  if (datasetModalHeader) datasetModalHeader.textContent = translationDict[lang].datasetModalHeader;


  // Claim Section
  const claimHeading = document.querySelector(".claim-input-group h3");
  if (claimHeading) claimHeading.textContent = translationDict[lang].enterClaim;

  const inputClaimPlaceholder = document.getElementById("inputClaim");
  if (inputClaimPlaceholder) inputClaimPlaceholder.placeholder = translationDict[lang].inputClaimPlaceholder;

  const existingClaimsWrapperLabel = document.querySelector("#existingClaimsWrapper label");
  if (existingClaimsWrapperLabel) existingClaimsWrapperLabel.textContent = translationDict[lang].existingClaimsWrapperLabel;

  const includeTableTitleInPrompt = document.getElementById("includeTableTitleInPrompt");
  if (includeTableTitleInPrompt) includeTableTitleInPrompt.textContent = translationDict[lang].includeTableTitleInPrompt;

  // Live Check Section
  const runLiveCheckBtn = document.getElementById("runLiveCheck");
  if (runLiveCheckBtn) runLiveCheckBtn.textContent = translationDict[lang].runLiveCheckBtn;

  // Disclaimer
  const aiDisclaimer = document.querySelector("#aiDisclaimer");
  if (aiDisclaimer) aiDisclaimer.textContent = translationDict[lang].aiDisclaimer;
  const liveCheckInfo = document.querySelector("#liveCheckInfo");
  if (liveCheckInfo) liveCheckInfo.textContent = translationDict[lang].liveCheckInfo;
}