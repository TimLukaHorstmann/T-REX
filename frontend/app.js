//
// app.js
//

// CONSTANTS for paths
const CSV_BASE_PATH = "/static/data/all_csv/";
const ALL_CSV_IDS_PATH = "/static/data/all_csv_ids.json";
const TABLE_TO_PAGE_JSON_PATH = "/static/data/table_to_page.json";
const TOTAL_EXAMPLES_PATH = "/static/data/total_examples.json";
const R1_TRAINING_ALL_PATH = "/static/data/r1_training_all.json";
const R2_TRAINING_ALL_PATH = "/static/data/r2_training_all.json";
const FULL_CLEANED_PATH = "/static/data/full_cleaned.json";

const resultsFolder = "/static/data/results";
const MANIFEST_JSON_PATH = "/static/data/results/manifest.json";

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
let tableIdToClaimsMap = {}; // table_id -> claims
let thinkStartRemainder = ""; // ← buffer for any partial "<think>" tag
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
let ocrAbortController = null;

let cachedCsvIds = null;

// Disable auto-scroll if the user scrolls up manually.
let autoScrollEnabled = true;
let lastScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
let isUserScrolling = false;
let scrollTimeout = null;

// Check if the user is near the bottom
function isNearBottom(threshold = 50) {
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  return currentScroll >= maxScroll - threshold;
}

// Immediate scroll handler to detect direction and disable auto-scroll
const handleScrollImmediate = () => {
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
  const scrollingUp = currentScroll < lastScrollPosition;

  // If scrolling up, disable auto-scroll immediately
  if (scrollingUp) {
    autoScrollEnabled = false;
    isUserScrolling = true;
  }

  lastScrollPosition = currentScroll;
};

// Debounced scroll handler for re-enabling auto-scroll
const handleScrollDebounced = () => {
  const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
  const nearBottom = isNearBottom(50);

  // Re-enable auto-scroll only if near bottom after stopping
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    if (nearBottom) {
      isUserScrolling = false;
      autoScrollEnabled = true;
    }
  }, 500); // 500ms delay to confirm user has stopped scrolling
};

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Add event listeners
window.addEventListener("scroll", handleScrollImmediate);
window.addEventListener("scroll", debounce(handleScrollDebounced, 100));

/**
 * Converts a TabFact table (cells separated by "#") into a proper CSV.
 * For each cell, if it contains a comma, double quote, or newline,
 * the cell is wrapped in double quotes and internal double quotes are escaped.
 */
function convertTabfactToCSV(tabfactText) {
  const lines = tabfactText.trim().split(/\r?\n/);
  const csvLines = lines.map(line => {
    const cells = line.split("#");
    const processedCells = cells.map(cell => {
      const trimmed = cell.trim();
      if (trimmed.includes(",") || trimmed.includes('"') || trimmed.includes("\n")) {
        const escaped = trimmed.replace(/"/g, '""');
        return `"${escaped}"`;
      }
      return trimmed;
    });
    return processedCells.join(",");
  });
  return csvLines.join("\n");
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    validateLiveCheckInputs();
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
      parseManifest(manifest);

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
      ["modelSelect", "learningTypeSelect", "nValueSelect", "formatTypeSelect"].forEach(id => {
        document.getElementById(id).addEventListener("change", updateDropdownsAndDisableInvalidOptions);
      });
      updateDropdownsAndDisableInvalidOptions();

    } catch (manifestError) {
      console.warn("Failed to fetch or parse manifest.json. Continuing without manifest.", manifestError);
    }

    // SETUP MODEL SELECTOR
    const modelSelectorBtn = document.getElementById("modelSelectorBtn");
    const modelModal       = document.getElementById("modelModal");
    // const closeModelModal  = document.getElementById("closeModelModal"); // No longer needed
    const modelOptions    = document.querySelectorAll(".model-option");
    const liveModelSelect = document.getElementById("liveModelSelect");
    const currentModelName= document.getElementById("currentModelName");
    const thinkingOptionDiv = document.getElementById("thinkingOption");

    // Set initial model button text based on hidden select
    const initialModelOption = liveModelSelect.options[liveModelSelect.selectedIndex];
    if (initialModelOption) {
        const selectedModelValue = initialModelOption.value;
        const selectedOptionDiv = document.querySelector(`.model-option[data-model="${selectedModelValue}"]`);
        if (selectedOptionDiv) {
            const headerText = selectedOptionDiv.querySelector('.model-option-header').textContent.replace(/\s*\d+b\s*$/, '').trim(); // Remove param count
            const paramBubble = selectedOptionDiv.querySelector('.model-param-bubble');
            currentModelName.textContent = headerText; // Set only the name
            // Update the bubble in the button
            const buttonBubble = modelSelectorBtn.querySelector('.model-param-bubble');
            if (buttonBubble && paramBubble) {
                buttonBubble.textContent = paramBubble.textContent;
            } else if (buttonBubble) {
                 buttonBubble.textContent = ''; // Clear if no bubble exists for the model
                 buttonBubble.style.display = 'none'; // Hide bubble element
            }
        } else {
             currentModelName.textContent = initialModelOption.text.replace(/\s*\(\d+b\)\s*$/, '').trim(); // Fallback, remove param count
             const buttonBubble = modelSelectorBtn.querySelector('.model-param-bubble');
             if (buttonBubble) {
                 // Attempt to extract param count from original text if needed, or hide
                 const match = initialModelOption.text.match(/\((\d+b)\)/);
                 if (match) {
                     buttonBubble.textContent = match[1];
                     buttonBubble.style.display = 'inline-block';
                 } else {
                     buttonBubble.textContent = '';
                     buttonBubble.style.display = 'none';
                 }
             }
        }
    }


    // Toggle the model dropdown
    modelSelectorBtn.addEventListener("click", e => {
        e.stopPropagation(); // Prevent click from closing immediately
        modelModal.classList.toggle("visible");
        // Hide language modal if open
        document.getElementById("languageModal").classList.remove("visible");
    });

    // Select a model
    modelOptions.forEach(opt => {
        opt.addEventListener("click", () => {
            if (opt.classList.contains('disabled')) {
                return; // Do nothing if the option is disabled
            }

            const modelValue = opt.getAttribute("data-model");
            const headerText = opt.querySelector('.model-option-header').textContent.replace(/\s*\d+b\s*$/, '').trim(); // Get text without bubble
            const paramBubble = opt.querySelector('.model-param-bubble');

            // Update hidden select
            liveModelSelect.value = modelValue;

            // Update button text and bubble
            currentModelName.textContent = headerText;
            const buttonBubble = modelSelectorBtn.querySelector('.model-param-bubble');
             if (buttonBubble && paramBubble) {
                 buttonBubble.textContent = paramBubble.textContent;
                 buttonBubble.style.display = 'inline-block'; // Ensure it's visible
             } else if (buttonBubble) {
                 buttonBubble.textContent = ''; // Clear if no bubble exists
                 buttonBubble.style.display = 'none'; // Hide bubble element
             }


            // Trigger change event for compatibility
            liveModelSelect.dispatchEvent(new Event('change'));

            // Hide modal
            modelModal.classList.remove("visible");

            // Update thinking option visibility
            thinkingOptionDiv.style.display = modelValue === "cogito" ? "flex" : "none";
            if (modelValue !== "cogito") {
                document.getElementById("enableThinkingCheck").checked = false;
            }
            validateLiveCheckInputs(); // Re-validate inputs after model change
        });
    });

    // Handle thinking option visibility on model change
    liveModelSelect.addEventListener("change", () => {
        thinkingOptionDiv.style.display = liveModelSelect.value === "cogito" ? "flex" : "none";
        if (liveModelSelect.value !== "cogito") {
            document.getElementById("enableThinkingCheck").checked = false;
        }
        validateLiveCheckInputs();
    });
    // Initial check for thinking option
    thinkingOptionDiv.style.display = liveModelSelect.value === "cogito" ? "flex" : "none";


    // SETUP LANGUAGE SELECTOR
    const languageSelectorBtn = document.getElementById("languageSelectorBtn");
    const languageModal = document.getElementById("languageModal");
    const languageOptions = document.querySelectorAll(".language-option");
    const liveLanguageSelect = document.getElementById("liveLanguageSelect"); // Hidden select
    const currentLanguageName = document.getElementById("currentLanguageName");

    // Set initial language button text based on hidden select
    const initialLangOption = liveLanguageSelect.options[liveLanguageSelect.selectedIndex];
    if (initialLangOption) {
        // Find the corresponding visible option to get the display text
        const initialLangTextElement = document.querySelector(`.language-option[data-lang="${initialLangOption.value}"] .language-option-header`);
        if (initialLangTextElement) {
            currentLanguageName.textContent = initialLangTextElement.textContent;
        } else {
             currentLanguageName.textContent = initialLangOption.text; // Fallback
        }
    }

    // Toggle the language dropdown
    languageSelectorBtn.addEventListener("click", e => {
      e.stopPropagation();
      languageModal.classList.toggle("visible");
      // Close model modal if open
      document.getElementById("modelModal").classList.remove("visible");
    });

    // Select a language
    languageOptions.forEach(opt => {
      opt.addEventListener("click", () => {
        const langValue = opt.getAttribute("data-lang");
        const langText = opt.querySelector(".language-option-header").textContent;

        liveLanguageSelect.value = langValue; // Update hidden select
        currentLanguageName.textContent = langText; // Update button text
        languageModal.classList.remove("visible"); // Close dropdown

        // Trigger change event on hidden select to run existing logic
        liveLanguageSelect.dispatchEvent(new Event('change'));
      });
    });

    // Close modals if clicking outside
    document.addEventListener("click", e => {
      // Close model modal
      if (!modelModal.contains(e.target) && e.target !== modelSelectorBtn && modelModal.classList.contains("visible")) {
        modelModal.classList.remove("visible");
      }
      // Close language modal
      if (!languageModal.contains(e.target) && e.target !== languageSelectorBtn && languageModal.classList.contains("visible")) {
        languageModal.classList.remove("visible");
      }
    });


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

    // Language selection
    const languageSelect = document.getElementById("liveLanguageSelect");
    // const lang = document.getElementById("liveLanguageSelect").value; // Get initial lang - Not needed here
    // const translation = translationDict[lang] || translationDict["en"]; // Keep this if used elsewhere
    if (languageSelect) {
      languageSelect.addEventListener("change", () => {
        updateTranslations(); // Update text first
        updateModelOptionsBasedOnLanguage(); // Then handle model enabling/disabling
      });
      // Initial calls
      updateTranslations(); // Call on init
      updateModelOptionsBasedOnLanguage(); // Call on init AFTER translations
    }

    // Handle paste events in the table textarea
    document.getElementById("inputTable").addEventListener("paste", function (e) {
      const items = e.clipboardData.items;
      let textPasted = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          const loadingModal = document.getElementById("loadingModal");
          loadingModal.style.display = "flex";
          const imagePreview = document.getElementById("imagePreview");
          const url = URL.createObjectURL(file);
          imagePreview.innerHTML = `<span class="close-preview">×</span><img src="${url}" alt="Pasted Image Preview">`;
          imagePreview.style.display = "block";
          
          processImageViaBackend(file)
            .then(csvText => {
              loadingModal.style.display = "none";
              const inputTableEl = document.getElementById("inputTable");
              inputTableEl.value = csvText;
              renderLivePreviewTable(csvText, []);
              validateLiveCheckInputs();
            })
            .catch(err => {
              loadingModal.style.display = "none";
              console.error("OCR processing error on paste:", err);
              alert("Failed to process the pasted image: " + err.message);
            });
          e.preventDefault();
          return;
        } else if (items[i].type === "text/plain") {
          textPasted = true;
        }
      }
      if (textPasted) {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        this.value = text;
        setTimeout(() => {
          const event = new Event("input", { bubbles: true });
          this.dispatchEvent(event);
        }, 0);
      }
    });
    // Remove image preview on close button click
    const imagePreviewEl = document.getElementById("imagePreview");
    imagePreviewEl.addEventListener("click", function (e) {
      if (e.target.classList.contains("close-preview")) {
        imagePreviewEl.style.display = "none";
        imagePreviewEl.querySelectorAll("img").forEach(img => img.remove());
      }
    });

    // Close the loading modal when clicking the close button.
    document.querySelector("#loadingModal .close-modal").addEventListener("click", function() {
      document.getElementById("loadingModal").style.display = "none";
      if (ocrAbortController) {
        ocrAbortController.abort();
        ocrAbortController = null;
      }
    });
    
    document.querySelectorAll("textarea").forEach(textarea => {
      textarea.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
      });
    });

    // Toggle functionality for the live meta-info section
    const toggleLiveMetaInfoBtn = document.getElementById("toggleLiveMetaInfoBtn");
    if (toggleLiveMetaInfoBtn) {
      toggleLiveMetaInfoBtn.addEventListener("click", function() {
        const lang = document.getElementById("liveLanguageSelect").value;
        const translation = translationDict[lang] || translationDict["en"];
        const metaInfo = document.getElementById("liveTableMetaInfo");
        if (metaInfo.classList.contains("collapsed")) {
          metaInfo.classList.remove("collapsed");
          toggleLiveMetaInfoBtn.textContent = "▲ " + translation.tableDetails;
        } else {
          metaInfo.classList.add("collapsed");
          toggleLiveMetaInfoBtn.textContent = "▼ " + translation.tableDetails;
        }
      });
    }

    // Toggle functionality for the live preview table section
    const toggleLivePreviewTableBtn = document.getElementById("toggleLivePreviewTableBtn");
    if (toggleLivePreviewTableBtn) {
      toggleLivePreviewTableBtn.addEventListener("click", function() {
        const lang = document.getElementById("liveLanguageSelect").value;
        const translation = translationDict[lang] || translationDict["en"];
        const previewTable = document.getElementById("livePreviewTableContainer");
        if (previewTable.classList.contains("collapsed")) {
          previewTable.classList.remove("collapsed");
          toggleLivePreviewTableBtn.textContent = "▲ " + translation.tablePreview;
        } else {
          previewTable.classList.add("collapsed");
          toggleLivePreviewTableBtn.textContent = "▼ " + translation.tablePreview;
        }
      });
    }

    // Initialize marked.js for Markdown rendering
    marked.setOptions({
      gfm:       true,
      headerIds: true,
      mangle:    true,
      breaks:    true, // Enable line breaks in Markdown
      // breaks:false (implicit default)
    });

    // Setup MutationObserver for Wikipedia preview errors
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length) {
          const lang = document.getElementById("liveLanguageSelect").value;
          const errorMessages = document.querySelectorAll('.wikipediapreview-body-message span');
          errorMessages.forEach(span => {
            const grandparent = span.parentElement.parentElement;
            if (grandparent && grandparent.classList.contains('wikipediapreview-body-error') &&
                span.textContent === "There was an issue while displaying this preview.") {
              const translation = translationDict[lang] || translationDict["en"];
              span.textContent = translation.wikipediaNoSummary;
            }
          });
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

  } catch (error) {
    console.error("Initialization failed:", error);
    document.getElementById("infoPanel").innerHTML = `<p style="color:red;">Failed to initialize the app: ${error}</p>`;
  }
});

  // --- COGITO deep‑thinking toggle ---
  const liveModelSelect = document.getElementById("liveModelSelect");
  const thinkingOptionDiv = document.getElementById("thinkingOption");
  liveModelSelect.addEventListener("change", () => {
    if (liveModelSelect.value === "cogito") {
      thinkingOptionDiv.style.display = "flex";
    } else {
      thinkingOptionDiv.style.display = "none";
      document.getElementById("enableThinkingCheck").checked = false;
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
    const regex = /^results_with_cells_(.+?)_(test_examples)_(\d+|all)_(zero_shot|one_shot|few_shot|chain_of_thought)_(naturalized|markdown|json|html)\.json$/;
    const match = shortName.match(regex);
    if (match) {
      const [_, model, , nValue, learningType, formatType] = match;
      manifestOptions.push({ model, dataset: "test_examples", nValue, learningType, formatType, filename });
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
  populateSelect("learningTypeSelect", learningTypes, "", true);
  populateSelect("nValueSelect", nValues, "", true);
  populateSelect("formatTypeSelect", formatTypes, "", true);
}

function isValidCombination(model, learningType, nValue, formatType) {
  return manifestOptions.some(opt => {
    if (model && opt.model !== model) return false;
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
  const currentDataset = "test_examples";
  const currentLearningType = document.getElementById("learningTypeSelect").value;
  const currentNValue = document.getElementById("nValueSelect").value;
  const currentFormatType = document.getElementById("formatTypeSelect").value;

  updateDropdownDisabledState("modelSelect", candidate =>
    isValidCombination(candidate, currentLearningType, currentNValue, currentFormatType)
  );
  updateDropdownDisabledState("learningTypeSelect", candidate =>
    isValidCombination(currentModel, candidate, currentNValue, currentFormatType)
  );
  updateDropdownDisabledState("nValueSelect", candidate =>
    isValidCombination(currentModel, currentLearningType, candidate, currentFormatType)
  );
  updateDropdownDisabledState("formatTypeSelect", candidate =>
    isValidCombination(currentModel, currentLearningType, currentNValue, candidate)
  );

  const loadBtn = document.getElementById("loadBtn");
  const allValues = [currentModel, currentLearningType, currentNValue, currentFormatType];
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
  const datasetName = "test_examples";
  const learningType = document.getElementById("learningTypeSelect").value;
  const nValue = document.getElementById("nValueSelect").value;
  const formatType = document.getElementById("formatTypeSelect").value;
  const resultsFileName = `${resultsFolder}/results_with_cells_${modelName}_${datasetName}_${nValue}_${learningType}_${formatType}.json`;
  
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
    if (title) {
      title = title.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      option.innerHTML = `<strong>${title}</strong> [${tid}]`;
    } else {
      option.textContent = tid;
    }
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
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];

  document.getElementById("full-highlight-legend-precomputed").style.display = "none";
  document.getElementById("full-entity-highlight-legend-precomputed").style.display = "none";
  const container = document.getElementById("table-container");
  container.innerHTML = "";

  // Display claim info
  const infoDiv = document.createElement("div");
  infoDiv.className = "info-panel";
  infoDiv.innerHTML = `
    <p><strong>Claim:</strong> ${resultObj.claim}</p>
    <p><strong>Predicted:</strong> ${resultObj.predicted_response ? "TRUE" : "FALSE"}</p>
    <p><strong>Raw Output:</strong> ${resultObj.resp}</p>
    <p><strong>Ground Truth:</strong> ${resultObj.true_response ? "TRUE" : "FALSE"}</p>
  `;
  container.appendChild(infoDiv);

  // Display meta info (table title, Wikipedia link)
  const metaDiv = document.getElementById("tableMetaInfo");
  metaDiv.innerHTML = "";
  const meta = tableToPageMap[resultObj.table_id];
  if (meta) {
    const [tableTitle, wikipediaUrl] = meta;
    const langCode = lang === "en" ? "" : lang + ".";
    const newWikipediaUrl = wikipediaUrl.replace(/https:\/\/en\./, `https://${langCode}`);
    const tableTitleLabel = translation.table_title || "Table Title";
    metaDiv.innerHTML = `
      <div class="meta-info-box">
        <p><strong id="tableTitleLabel">${tableTitleLabel}</strong> ${tableTitle}</p>
        <p><strong>Wikipedia Link:</strong> <a href="${newWikipediaUrl}" data-wikipedia-preview data-wp-title="${tableTitle}" data-wp-lang="${lang}" target="_blank">${newWikipediaUrl}</a></p>
      </div>
    `;
  } else {
    metaDiv.innerHTML = `<p><em>No title/link found for this table</em></p>`;
  }

  // Load the CSV from file
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

  // Parse CSV by detecting the delimiter from the first line.
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (!lines.length) {
    container.appendChild(document.createElement("p")).textContent = "Table is empty or could not be parsed.";
    return;
  }
  const firstLine = lines[0];
  const delimiter = (firstLine.includes(",") && (!firstLine.includes("#") || firstLine.split(",").length > firstLine.split("#").length)) ? "," : "#";
  const tableData = lines.map(line => line.split(delimiter));

  const columns = tableData[0];
  const dataRows = tableData.slice(1);

  // Build the table element
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
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
  container.appendChild(tableEl);

  // Update model-highlighted legend with translated text
  if (tableEl.querySelectorAll("td.highlight").length > 0) {
    document.getElementById("full-highlight-legend-precomputed").innerHTML = `<span class="highlight-legend"></span> ${translation.modelHighlightedCells}`;
    document.getElementById("full-highlight-legend-precomputed").style.display = "block";
  }

  // Entity highlighting
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
    Array.from(tbody.rows).forEach((tr, rowIndex) => {
      Array.from(tr.cells).forEach((td, colIndex) => {
        if (entityCoords.some(coord => coord.row === rowIndex && coord.col === colIndex)) {
          td.classList.add("entity-highlight");
        }
      });
    });
    document.getElementById("full-entity-highlight-legend-precomputed").innerHTML = `<span class="entity-highlight-legend"></span> ${translation.entityLinkedCells}`;
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

  const isDarkMode = document.body.classList.contains('dark-mode');
  
  const plotly_config = {
    modeBarButtonsToRemove: [
      'zoom2d',
      'pan2d',
      'zoomIn2d',
      'zoomOut2d',
      'autoScale2d',
      'resetScale2d',
      'select2d',
      'lasso2d'
    ]
  };
  
  const matrix = [
    [TN, FP],
    [FN, TP]
  ];
  
  const heatmapData = [{
      z: matrix,
      x: ['Pred. Neg.', 'Pred. Pos.'],
      y: ['Act. Neg.', 'Act. Pos.'],
      type: 'heatmap',
      colorscale: isDarkMode ? [
        [0, '#1e1e1e'],
        [0.5, '#444'],
        [1, '#4caf50']
      ] : 'Inferno',
      showscale: false
  }];
  
  const heatmapLayout = {
    title: 'Confusion Matrix',
    annotations: [],
    xaxis: { title: 'Predicted' },
    yaxis: { title: 'Actual' },
    paper_bgcolor: isDarkMode ? '#333' : '#fff',
    plot_bgcolor: isDarkMode ? '#333' : '#fff',
    font: {
      color: isDarkMode ? '#e0e0e0' : '#333'
    }
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
  
  Plotly.newPlot('confusionMatrixPlot', heatmapData, heatmapLayout, plotly_config);
  
  const precision = (TP + FP) > 0 ? TP / (TP + FP) : 0;
  const recall    = (TP + FN) > 0 ? TP / (TP + FN) : 0;
  const accuracy  = (TP + TN) / (TP + TN + FP + FN);
  const f1        = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  
  const summaryData = [{
    x: ['Accuracy', 'Precision', 'Recall', 'F1 Score'],
    y: [accuracy, precision, recall, f1],
    type: 'bar',
    marker: {
      color: isDarkMode ? ['#4caf50', '#2196f3', '#ff9800', '#f44336'] : undefined
    }
  }];
  
  const summaryLayout = {
    title: 'Performance Summary',
    yaxis: { range: [0, 1], title: 'Score' },
    paper_bgcolor: isDarkMode ? '#333' : '#fff',
    plot_bgcolor: isDarkMode ? '#333' : '#fff',
    font: {
      color: isDarkMode ? '#e0e0e0' : '#333'
    }
  };
  
  Plotly.newPlot('performanceSummaryPlot', summaryData, summaryLayout, plotly_config);
}

function updateResultsChart(tableId) {
  const resultsHeader = document.getElementById("resultsHeader");
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
      barPercentage: 0.5,
      categoryPercentage: 0.8,
    }]
  };
  
  const isDarkMode = document.body.classList.contains('dark-mode');
  const ctx = document.getElementById("resultsChart").getContext("2d");
  if (resultsChartInstance) {
    resultsChartInstance.data = data;
    resultsChartInstance.options.scales.y.ticks.color = isDarkMode ? "#e0e0e0" : "#333";
    resultsChartInstance.options.scales.x.ticks.color = isDarkMode ? "#e0e0e0" : "#333";
    resultsChartInstance.options.scales.x.stacked = false;
    resultsChartInstance.options.scales.y.stacked = false;
    resultsChartInstance.update();
  } else {
    resultsChartInstance = new Chart(ctx, {
      type: "bar",
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            display: false,
            labels: {
              color: isDarkMode ? "#e0e0e0" : "#333"
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.label}: ${context.parsed.y !== undefined ? context.parsed.y : context.parsed}`;
              }
            },
            bodyColor: isDarkMode ? "#e0e0e0" : "#333",
            titleColor: isDarkMode ? "#e0e0e0" : "#333"
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: isDarkMode ? "#e0e0e0" : "#333" },
            stacked: false,
          },
          x: {
            ticks: { color: isDarkMode ? "#e0e0e0" : "#333" },
            stacked: false,
          }
        }
      }
    });
  }
}

/* LIVE CHECK FUNCTIONS */

// + BUTTON OPTIONS

document.getElementById("tableOptionsBtn").addEventListener("click", function (e) {
  e.stopPropagation();
  const dropdown = document.getElementById("tableOptionsDropdown");
  dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
});

document.addEventListener("click", function (e) {
  const dropdown = document.getElementById("tableOptionsDropdown");
  if (!dropdown.contains(e.target)) {
    dropdown.style.display = "none";
  }
});

document.getElementById("selectFromDatasetBtn").addEventListener("click", async function () {
  document.getElementById("tableOptionsDropdown").style.display = "none";
  openDatasetOverviewModal();
});

document.getElementById("uploadCSVBtn").addEventListener("click", function () {
  document.getElementById("tableOptionsDropdown").style.display = "none";
  const fileInput = document.getElementById("fileUpload");
  if (fileInput) {
    fileInput.click();
  } else {
    alert("File upload is not available.");
  }
});

const BATCH_SIZE = 1000;
let loadedItems = 0;
let totalDatasetItems = 0;

async function fetchDatasetPage(offset, limit) {
  const url = `/api/dataset_ids?offset=${offset}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset IDs: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

async function openDatasetOverviewModal() {
  const modal = document.getElementById("datasetOverviewModal");
  const datasetList = document.getElementById("datasetList");
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];

  loadedItems = 0;
  datasetList.innerHTML = `<p class="dataset-loading-message">${translation.loading_Message}</p>`;
  modal.style.display = "flex";

  try {
    const data = await fetchDatasetPage(loadedItems, BATCH_SIZE);
    totalDatasetItems = data.total;
    datasetList.innerHTML = `<p class="dataset-loading-message">${totalDatasetItems} ${translation.tables_loaded}.</p>`;
    await loadNextBatch(datasetList, lang);

    const observer = new IntersectionObserver(
      async (entries, observer) => {
        if (entries[0].isIntersecting && loadedItems < totalDatasetItems) {
          await loadNextBatch(datasetList, lang);
        }
      },
      { root: datasetList, rootMargin: "0px", threshold: 0.1 }
    );

    let sentinel = document.getElementById("sentinel");
    if (!sentinel) {
      sentinel = document.createElement("div");
      sentinel.id = "sentinel";
      sentinel.innerHTML = `
        <div class="loading-spinner" style="text-align: center; padding: 20px;">
          <div class="spinner"></div>
          <p>${translation.loading_Message}</p>
        </div>`;
      datasetList.appendChild(sentinel);
    }
    observer.observe(sentinel);

    modal.addEventListener("click", function cleanup(e) {
      if (e.target === modal) {
        observer.disconnect();
        modal.removeEventListener("click", cleanup);
      }
    });
  } catch (err) {
    datasetList.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
    console.error("Error in dataset modal:", err);
  }
}

async function loadNextBatch(datasetList, lang) {
  try {
    const translation = translationDict[lang] || translationDict["en"];
    const data = await fetchDatasetPage(loadedItems, BATCH_SIZE);
    const ids = data.ids;

    if (ids.length === 0) {
      const sentinel = document.getElementById("sentinel");
      if (sentinel) sentinel.style.display = "none";
      return;
    }

    const fragment = document.createDocumentFragment();
    ids.forEach((csvId, index) => {
      const item = document.createElement("div");
      item.classList.add("dataset-item");

      let title = "No title";
      let wiki = "";
      if (tableToPageMap && tableToPageMap[csvId]) {
        title = tableToPageMap[csvId][0] || title;
        wiki = tableToPageMap[csvId][1] || "";
      }
      title = title.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const langCode = lang === "en" ? "" : lang + ".";
      const newWikipediaUrl = wiki ? wiki.replace(/https:\/\/en\./, `https://${langCode}`) : "";

      item.innerHTML = `
        <div class="dataset-item-header">
          <span class="dataset-item-number">${loadedItems + index + 1}.</span>
          <span class="dataset-item-title"><strong>${title}</strong> (${csvId})</span>
          ${
            wiki
              ? `<a class="dataset-item-wiki-link" href="${newWikipediaUrl}" target="_blank" data-wikipedia-preview data-wp-title="${title}" data-wp-lang="${lang}"><img src="images/wiki.svg" alt="Wikipedia" class="wiki-icon" loading="lazy"></a>`
              : ""
          }
        </div>
      `;
      item.addEventListener("click", async function () {
        await fetchAndFillTable(csvId);
        populateClaimsDropdown(csvId);
        document.getElementById("datasetOverviewModal").style.display = "none";
        selectedTableId = csvId;
        globalCSVId = csvId;
      });
      fragment.appendChild(item);
    });

    loadedItems += ids.length;
    datasetList.insertBefore(fragment, document.getElementById("sentinel"));

    wikipediaPreview.init({
      root: datasetList,
      lang: lang,
      detectLinks: true,
      onFail: function(element, wikiData) {
        console.log("onFail triggered:", element, wikiData);
        const translation = translationDict[lang] || translationDict["en"];
        return `<p>${translation.wikipediaNoSummary}</p>`;
      }
    });
  
    setTimeout(() => {
      patchWikipediaPreviewErrors(datasetList, lang);
    }, 1000);

    if (loadedItems >= totalDatasetItems) {
      const sentinel = document.getElementById("sentinel");
      if (sentinel) sentinel.style.display = "none";
    }
  } catch (err) {
    console.error("Error loading batch:", err);
    const sentinel = document.getElementById("sentinel");
    if (sentinel) {
      sentinel.innerHTML = `<p style="color:red; text-align:center;">Error loading more items: ${err.message}</p>`;
    }
  }
}

function patchWikipediaPreviewErrors(rootElement, lang) {
  const translation = translationDict[lang] || translationDict["en"];
  const errorMessages = rootElement.querySelectorAll('.wikipediapreview-body-message span');
  errorMessages.forEach(span => {
    const grandparent = span.parentElement.parentElement;
    if (grandparent && grandparent.classList.contains('wikipediapreview-body-error') &&
        span.textContent === "There was an issue while displaying this preview.") {
      span.textContent = translation.wikipediaNoSummary;
    }
  });
}

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
  const tableTitleInput = document.getElementById("tableTitleInput"); // Get the input element
  const includeTableNameCheck = document.getElementById("includeTableNameCheck"); // Get the checkbox

  inputTableEl.value = "";
  previewContainer.innerHTML = "";
  tableTitleInput.value = ""; // Clear the title input initially
  includeTableNameCheck.checked = false; // Uncheck the box initially
  if (liveTableMetaInfo) {
    liveTableMetaInfo.style.display = "none";
    liveTableMetaInfo.innerHTML = "";
  }
  // Make the include title option always visible
  includeTableNameOption.style.display = "flex"; // Use flex as per CSS

  const csvUrl = CSV_BASE_PATH + tableId;
  try {
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    inputTableEl.value = csvText;
    renderLivePreviewTable(csvText, []);
    validateLiveCheckInputs();
    const meta = tableToPageMap[tableId];
    if (meta) {
      const [tableTitle, wikipediaUrl] = meta;
      const lang = document.getElementById("liveLanguageSelect").value;
      const translation = translationDict[lang] || translationDict["en"];
      const tableTitleLabel = translation.table_title || "Table Title";
      const langCode = lang === "en" ? "" : lang + ".";
      const newWikipediaUrl = wikipediaUrl.replace(/https:\/\/en\./, `https://${langCode}`);

      if (liveTableMetaInfo) {
        liveTableMetaInfo.innerHTML = `
          <div class="meta-info-box">
            <p><strong id="tableTitleLabel">${tableTitleLabel}:</strong> ${tableTitle}</p>
            <p><strong>Wikipedia Link:</strong> <a href="${newWikipediaUrl}" data-wikipedia-preview data-wp-title="${tableTitle}" data-wp-lang="${lang}" target="_blank">${newWikipediaUrl}</a></p>
          </div>
        `;
        liveTableMetaInfo.style.display = "block";
        // Ensure it's expanded if previously collapsed
        liveTableMetaInfo.classList.remove("collapsed");
        const toggleBtn = document.getElementById("toggleLiveMetaInfoBtn");
        if (toggleBtn) {
          toggleBtn.textContent = toggleBtn.textContent.replace("►", "▼");
          toggleBtn.style.display = "inline-block";
        }
      }

      wikipediaPreview.init({
        root: liveTableMetaInfo,
        lang: lang,
        detectLinks: true,
        onFail: function(element, wikiData) {
          console.log("onFail triggered:", element, wikiData);
          const translation = translationDict[lang] || translationDict["en"];
          return `<p>${translation.wikipediaNoSummary}</p>`;
        }
      });
      setTimeout(() => {
        patchWikipediaPreviewErrors(liveTableMetaInfo, lang);
      }, 1000);

      // Populate the input field with the fetched title
      tableTitleInput.value = tableTitle;
      // Optionally check the box by default when a title is present
      // includeTableNameCheck.checked = true;
    } else {
       // Hide meta info section if no meta found
       if (liveTableMetaInfo) liveTableMetaInfo.style.display = "none";
       const toggleBtn = document.getElementById("toggleLiveMetaInfoBtn");
       if (toggleBtn) toggleBtn.style.display = "none";
       // Keep the title input empty (placeholder will show)
       tableTitleInput.value = "";
    }
    // Auto-adjust height might be needed after content change
    inputTableEl.style.height = "auto";
    inputTableEl.style.height = (inputTableEl.scrollHeight) + "px";
    populateClaimsDropdown(tableId); // Populate claims dropdown for this table
    selectedTableId = tableId; // Store the selected table ID
  } catch (error) {
    console.error("Error loading table CSV:", error);
    alert("Failed to load table from dataset.");
    selectedTableId = null; // Reset selected table ID on error
    // Hide claims dropdown if table load fails
    document.getElementById("existingClaimsWrapper").style.display = "none";
  }
}

function populateClaimsDropdown(tableId) {
  const claimsWrapperEl = document.getElementById("existingClaimsWrapper");
  const claimsSelectEl = document.getElementById("existingClaimsSelect");

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

function renderMarkdownAndMath(markdownText, containerElement) {
  // Pre-process math expressions in square brackets to convert them to proper LaTeX delimiters
  let processedText = markdownText;
  
  // Convert square bracket math notation to proper LaTeX delimiters
  processedText = processedText.replace(/\[([^\]]+)\]/g, function(match, content) {
    // console.log("we are using the function")
    // console.log(content)
    // If it contains LaTeX-like commands or math symbols, it's probably a math expression
    if (content.includes('{' && '}')){
      return content
    }
    else if (content.includes('\\') || /[\+\-\*\/\=\(\)\<\>\{\}\^\~\_]/.test(content)) {
      return '$' + content + '$';
    }
    return match; // Not math, leave as is
  });
  
  // Also find LaTeX commands that aren't already in delimiters
  processedText = processedText.replace(/(\s|\(|\[|^)(\\frac|\\sqrt|\\sum|\\prod|\\int|\\lim|\\infty|\\pi|\\alpha|\\beta|\\gamma|\\delta|\\epsilon)([^$\n]*?)(\s|\)|]|$)/g, 
    function(match, prefix, command, content, suffix) {
      // Avoid double-wrapping if already in math delimiters
      if (prefix.includes('$') || suffix.includes('$')) {
        return match;
      }
      return prefix + '$' + command + content + '$' + suffix;
    }
  );
  
  const sanitizedHtml = DOMPurify.sanitize(marked.parse(processedText));
  containerElement.innerHTML = sanitizedHtml;
  
  // Process math using MathJax
  if (window.MathJax && window.MathJax.typesetPromise) {
    MathJax.typesetPromise([containerElement]).catch(err => {
      console.error('MathJax error:', err);
    });
  } else if (window.renderMathInElement) {
    renderMathInElement(containerElement, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ]
    });
  }
}

function setupLiveCheckEvents() {
  window.modelLoaded = true;
  const inputTableEl = document.getElementById("inputTable");
  const inputClaimEl = document.getElementById("inputClaim");
  const runLiveCheckBtn = document.getElementById("runLiveCheck");
  const includeTableNameOption = document.getElementById("includeTableNameOption"); // Get the container
  const tableTitleInput = document.getElementById("tableTitleInput"); // Get the input

  // Ensure the include title option is visible on load
  includeTableNameOption.style.display = "flex";

  inputTableEl.addEventListener("input", () => {
    const csvText = inputTableEl.value;
    renderLivePreviewTable(csvText, []);
    validateLiveCheckInputs();
    // When user manually edits the table, clear the TabFact ID and related fields
    selectedTableId = null;
    document.getElementById("existingClaimsWrapper").style.display = "none";
    document.getElementById("existingClaimsSelect").value = "";
    // Keep the title input as is, or clear it if desired:
    // tableTitleInput.value = "";
    // document.getElementById("includeTableNameCheck").checked = false;
    const liveTableMetaInfo = document.getElementById("liveTableMetaInfo");
    if (liveTableMetaInfo) liveTableMetaInfo.style.display = "none";
    const toggleBtn = document.getElementById("toggleLiveMetaInfoBtn");
    if (toggleBtn) toggleBtn.style.display = "none";
  });

  inputClaimEl.addEventListener("input", () => {
    validateLiveCheckInputs();
    // Clear selected claim from dropdown if user types manually
    document.getElementById("existingClaimsSelect").value = "";
  });

  inputClaimEl.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runLiveCheckBtn.click();
    }
  });

  runLiveCheckBtn.addEventListener("click", async () => {
    // Disable the Run button
    runLiveCheckBtn.disabled = true;
    runLiveCheckBtn.style.opacity = "0.6";
    runLiveCheckBtn.style.cursor = "not-allowed";

    const statusMessageEl = document.getElementById("statusMessage");
    statusMessageEl.style.display = "none";
    window.streamAborted = false;

    // Reset scrolling state
    autoScrollEnabled = true;
    isUserScrolling = false;
    lastScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    clearTimeout(scrollTimeout);

    // Handle queued state message
    const selectedLanguage = document.getElementById("liveLanguageSelect").value;
    const translation = window.translationDict[selectedLanguage] || window.translationDict["en"];
    let requestStatus = document.getElementById("requestStatus");
    let queuedTimer = setTimeout(() => {
      if (!requestStatus) {
        requestStatus = document.createElement("p");
        requestStatus.id = "requestStatus";
        requestStatus.className = "status-message";
        document.getElementById("liveCheckSection").insertBefore(requestStatus, document.getElementById("liveResults"));
      }
      requestStatus.style.display = "block";
      requestStatus.textContent = translation.queuedMessage;
    }, 2000);

    const liveResultsEl = document.getElementById("liveResults");
    const liveClaimList = document.getElementById("liveClaimList");
    liveStreamOutputEl.textContent = "";
    liveThinkOutputEl.textContent = "";
    liveStreamOutputEl.style.display = "none";
    liveThinkOutputEl.style.display = "none";
    liveClaimList.style.display = "none";
    liveResultsEl.style.display = "none";

    const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");

    // Streaming state
    let firstThinkTokenReceived = false;
    let firstAnswerTokenReceived = false;
    let finalText = "";
    let thinkText = "";
    let inThinkBlock = false;
    let buffer = "";
    // Buffers for partial tag fragments
    let pendingThinkStart = "";
    let pendingThinkEnd = "";

    const model = document.getElementById("liveModelSelect").value;
    const thinkTags = getThinkingTagsForModel(model);

    const tableText = document.getElementById("inputTable").value;
    const claimText = document.getElementById("inputClaim").value;
    const includeTitleCheck = document.getElementById("includeTableNameCheck").checked;
    const tableTitleInput = document.getElementById("tableTitleInput").value.trim(); // Get value from input
    let tableTitleToSend = "";

    // Use the input field's value if the checkbox is checked and the input is not empty
    if (includeTitleCheck && tableTitleInput) {
      tableTitleToSend = tableTitleInput;
    }
    const includeThinking = (
      document.getElementById("enableThinkingCheck").checked && model === "cogito"
    );

    const requestBody = {
      tableText,
      claimText,
      language: selectedLanguage,
      model,
      includeTitle: includeTitleCheck,
      tableTitle: tableTitleToSend,
      includeThinking,
      max_tokens: 2048,
      keep_alive: 0,
      stream: true
    };

    try {
      const response = await fetch(`/api/inference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      // Show Stop button
      const stopBtn = document.getElementById("stopLiveCheck");
      stopBtn.style.display = "inline-block";
      stopBtn.classList.add("running");

      globalReader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      const startTime = performance.now();
      let firstChunkReceived = false;

      while (true) {
        const { value, done } = await globalReader.read();

        if (!firstChunkReceived && value) {
          firstChunkReceived = true;
          clearTimeout(queuedTimer); // Clear the timer as soon as we get data
          let currentRequestStatus = document.getElementById("requestStatus");
          if (currentRequestStatus) {
            currentRequestStatus.style.display = "none";
            currentRequestStatus.remove();
          }
        }

        if (done || window.streamAborted) break;

        const chunkStr = decoder.decode(value, { stream: true });
        buffer += chunkStr;
        const lines = buffer.split("\n");
        buffer = lines.pop();

        const scrollBefore = window.pageYOffset || document.documentElement.scrollTop;
        const heightBefore = document.body.scrollHeight;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const token = JSON.parse(line);
            let tokenText = token.response;

            // Prepend any pending partial tag fragments
            if (!inThinkBlock && pendingThinkStart) {
              tokenText = pendingThinkStart + tokenText;
              pendingThinkStart = "";
            }
            if (inThinkBlock && pendingThinkEnd) {
              tokenText = pendingThinkEnd + tokenText;
              pendingThinkEnd = "";
            }

            // Detect and buffer a split '<think>' fragment
            if (!inThinkBlock && !tokenText.includes(thinkTags.start)) {
              for (let i = thinkTags.start.length - 1; i > 0; i--) {
                if (tokenText.endsWith(thinkTags.start.slice(0, i))) {
                  pendingThinkStart = thinkTags.start.slice(0, i);
                  tokenText = tokenText.slice(0, -i);
                  break;
                }
              }
            }
            // Detect and buffer a split '</think>' fragment
            if (inThinkBlock && !tokenText.includes(thinkTags.end)) {
              for (let i = thinkTags.end.length - 1; i > 0; i--) {
                if (tokenText.endsWith(thinkTags.end.slice(0, i))) {
                  pendingThinkEnd = thinkTags.end.slice(0, i);
                  tokenText = tokenText.slice(0, -i);
                  break;
                }
              }
            }

            // Original streaming logic (unchanged)
            while (tokenText.length > 0) {
              if (inThinkBlock) {
                const endIdx = tokenText.indexOf(thinkTags.end);
                if (endIdx !== -1) {
                  thinkText += tokenText.slice(0, endIdx);
                  tokenText = tokenText.slice(endIdx + thinkTags.end.length);
                  inThinkBlock = false;
                  continue;
                } else {
                  thinkText += tokenText;
                  tokenText = "";
                  if (!firstThinkTokenReceived) {
                    liveThinkOutputEl.style.display = "block";
                    liveThinkOutputEl.innerHTML = `
                      <div class="thinking-overlay">
                        <span id="thinkingLabel" class="thinking-label">${translation.thinkingLabel}</span>
                        <button id="toggleThinkingBtn" class="toggle-btn">▲</button>
                      </div>
                      <div id="thinkContent" class="collapsible"></div>
                    `;
                    const thinkContentDiv = document.getElementById("thinkContent");
                    renderMarkdownAndMath(thinkText.trim(), thinkContentDiv);
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
                const startIdx = tokenText.indexOf(thinkTags.start);
                if (startIdx !== -1) {
                  finalText += tokenText.slice(0, startIdx);
                  tokenText = tokenText.slice(startIdx + thinkTags.start.length);
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
                      <div id="answerContent" class="collapsible"></div>
                    `;
                    const answerContentDiv = document.getElementById("answerContent");
                    renderMarkdownAndMath(finalText.trim(), answerContentDiv);
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

            // Update displayed content if already initialized
            if (firstThinkTokenReceived) {
              const thinkContentDiv = document.getElementById("thinkContent");
              renderMarkdownAndMath(thinkText.trim(), thinkContentDiv);
            }
            if (firstAnswerTokenReceived) {
              const answerContentDiv = document.getElementById("answerContent");
              renderMarkdownAndMath(finalText.trim(), answerContentDiv);
            }

          } catch (e) {
            console.warn("Failed to parse JSON token:", e);
          }
        }

        // Auto-scroll behavior
        const heightAfter = document.body.scrollHeight;
        const wasNearBottomBefore = scrollBefore >= heightBefore - window.innerHeight - 50;
        if (autoScrollEnabled && !isUserScrolling && wasNearBottomBefore) {
          window.scrollTo({ top: heightAfter, behavior: "auto" });
        }
        const isAtBottom = isNearBottom(50);
        scrollToBottomBtn.style.display = isAtBottom ? "none" : "block";
      }

      // Handle leftover buffer
      if (buffer.trim() && !window.streamAborted) {
        try {
          const token = JSON.parse(buffer);
          let tokenText = token.response;
          while (tokenText.length > 0) {
            if (inThinkBlock) {
              const endIdx = tokenText.indexOf(thinkTags.end);
              if (endIdx !== -1) {
                thinkText += tokenText.slice(0, endIdx);
                tokenText = tokenText.slice(endIdx + thinkTags.end.length);
                inThinkBlock = false;
                continue;
              } else {
                thinkText += tokenText;
                tokenText = "";
                break;
              }
            } else {
              const startIdx = tokenText.indexOf(thinkTags.start);
              if (startIdx !== -1) {
                finalText += tokenText.slice(0, startIdx);
                tokenText = tokenText.slice(startIdx + thinkTags.start.length);
                inThinkBlock = true;
                continue;
              } else {
                finalText += tokenText;
                break;
              }
            }
          }
        } catch (e) {
          console.warn("Error processing final buffer:", e);
        }
      }

      const endTime = performance.now();
      if (!window.streamAborted) {
        // Finalize thinking label
        if (firstThinkTokenReceived) {
          const thinkingLabel = document.getElementById("thinkingLabel");
          const duration = ((endTime - startTime) / 1000).toFixed(1);
          thinkingLabel.textContent = translation.thoughtDurationLabel.replace('{duration}', duration);
          thinkingLabel.classList.add("done");
        }

        // Extract and display final JSON / answer
        const cleanedResponse = finalText.replace(/```(json)?/gi, "").trim();
        const parsedJson = extractJsonFromResponse(cleanedResponse);
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

        liveStreamOutputEl.innerHTML = `
          <div class="answer-overlay">
            <span id="answer-label">${translation.answerLabel}</span>
            <button id="toggleAnswerBtn" class="toggle-btn">▲</button>
          </div>
          <div id="answerContent" class="collapsible"></div>
        `;
        const answerContentDiv = document.getElementById("answerContent");
        renderMarkdownAndMath(cleanedResponse.trim(), answerContentDiv);
        answerContentDiv.innerHTML += jsonContainerHtml;
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

        scrollToBottomBtn.style.display = "none";
        liveResultsEl.style.display = "block";
        document.querySelectorAll('code.json.hljs').forEach(block => hljs.highlightElement(block));
        displayLiveResults(tableText, claimText, parsedJson.answer, parsedJson.relevant_cells);

        // Collapse panels by default
        setTimeout(() => {
          const thinkContent = document.getElementById("thinkContent");
          const answerContent = document.getElementById("answerContent");
          if (thinkContent && !thinkContent.classList.contains("collapsed")) {
            thinkContent.classList.add("collapsed");
            document.getElementById("toggleThinkingBtn").textContent = "▼";
          }
          if (answerContent && !answerContent.classList.contains("collapsed")) {
            answerContent.classList.add("collapsed");
            document.getElementById("toggleAnswerBtn").textContent = "▼";
          }
        }, 0);
      }

    } catch (err) {
      console.error("Live Check Error:", err);
      liveResultsEl.style.display = "none";
      statusMessageEl.style.display = "block";
      statusMessageEl.innerHTML = `
        An error occurred: ${err.message}
        <button id="retryBtn" class="btn-primary">${translation.retryBtn}</button>
      `;
      document.getElementById("retryBtn").addEventListener("click", () => {
        statusMessageEl.style.display = "none";
        runLiveCheckBtn.click();
      });
      scrollToBottomBtn.style.display = "none";
    } finally {
      if (queuedTimer) {
        clearTimeout(queuedTimer);
        if (requestStatus) requestStatus.style.display = "none";
      }
      scrollToBottomBtn.style.display = "none";
      runLiveCheckBtn.disabled = false;
      runLiveCheckBtn.style.opacity = "1";
      runLiveCheckBtn.style.cursor = "pointer";
      runLiveCheckBtn.innerHTML = translation.runLiveCheckBtn;
      document.getElementById("stopLiveCheck").style.display = "none";
      document.getElementById("stopLiveCheck").classList.remove("running");
      if (globalReader) {
        globalReader.cancel().catch(() => {});
        globalReader = null;
      }
    }
  });

  // Stop button handler
  const stopLiveCheckBtn = document.getElementById("stopLiveCheck");
  stopLiveCheckBtn.addEventListener("click", () => {
    window.streamAborted = true;
    if (globalReader) {
      globalReader.cancel("User aborted");
      console.log("Generation aborted by user.");
    }
    const liveResultsEl = document.getElementById("liveResults");
    liveResultsEl.style.display = "none";
    const abortMsgEl = document.getElementById("statusMessage");
    abortMsgEl.style.display = "block";
    const lang = document.getElementById("liveLanguageSelect").value;
    const translation = window.translationDict[lang] || window.translationDict["en"];
    abortMsgEl.textContent = translation.statusMessage;
    const runBtn = document.getElementById("runLiveCheck");
    runBtn.disabled = false;
    runBtn.style.opacity = "1";
    runBtn.style.cursor = "pointer";
    runBtn.classList.remove("loading");
    runBtn.innerHTML = translation.runLiveCheckBtn;
    stopLiveCheckBtn.style.display = "none";
    stopLiveCheckBtn.classList.remove("running");
  });

  // Scroll-to-bottom handler
  const scrollToBottomBtnEl = document.getElementById("scrollToBottomBtn");
  scrollToBottomBtnEl.addEventListener("click", () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    autoScrollEnabled = true;
  });
}

function fuzzyMatchAdvanced(str1, str2, threshold = 0.9) {
  const similarity = stringSimilarity.compareTwoStrings(str1, str2);
  return similarity >= threshold;
}

function renderLivePreviewTable(csvText, relevantCells) {
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];

  const previewContainer = document.getElementById("livePreviewTable");
  previewContainer.innerHTML = "";

  let csvToParse = csvText;
  const firstLine = csvText.split(/\r?\n/)[0] || "";
  if (firstLine.includes("#") && !firstLine.includes(",")) {
    csvToParse = convertTabfactToCSV(csvText);
    document.getElementById("inputTable").value = csvToParse;
  }
  const parsed = Papa.parse(csvToParse, { skipEmptyLines: true, delimiter: "," });

  if (parsed.errors && parsed.errors.length > 0) {
    console.error("CSV Parsing Errors:", parsed.errors);
    return;
  }
  const tableData = parsed.data;
  if (!tableData || tableData.length === 0) return;

  const columns = tableData[0];
  const dataRows = tableData.slice(1);
  const hasRowIndex = columns[0].toLowerCase() === "row_index";
  const displayColumns = hasRowIndex ? columns.slice(1) : columns;

  const tableEl = document.createElement("table");
  tableEl.classList.add("styled-table");

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  displayColumns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");
  dataRows.forEach((rowVals, rowIndex) => {
    const tr = document.createElement("tr");
    const displayRow = hasRowIndex ? rowVals.slice(1) : rowVals;
    const rowIdxValue = hasRowIndex ? parseInt(rowVals[0]) : rowIndex;

    displayRow.forEach((cellVal, colIndex) => {
      const td = document.createElement("td");
      td.textContent = cellVal;
      const colName = displayColumns[colIndex] || "";
      const colNameLower = colName.toLowerCase().replace(/\s+/g, '');
      const shouldHighlight = relevantCells.some(hc => {
        const hcColNormalized = hc.column_name.toLowerCase().replace(/\s+/g, '');
        return hc.row_index === rowIdxValue && fuzzyMatchAdvanced(hcColNormalized, colNameLower);
      });
      if (shouldHighlight) {
        td.classList.add("highlight");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);

  previewContainer.innerHTML = "";
  previewContainer.appendChild(tableEl);

  const legendModel = document.getElementById("full-highlight-legend-live");
  if (tableEl.querySelectorAll("td.highlight").length > 0) {
    legendModel.innerHTML = `<span class="highlight-legend"></span> ${translation.modelHighlightedCells}`;
    legendModel.style.display = "block";
  } else {
    legendModel.style.display = "none";
  }
  
  const previewContainerWrapper = document.getElementById("livePreviewTableContainer");
  if (previewContainerWrapper) {
    previewContainerWrapper.style.display = "block";
  }
  const togglePreviewBtn = document.getElementById("toggleLivePreviewTableBtn");
  if (togglePreviewBtn) {
    togglePreviewBtn.style.display = "inline-block";
    togglePreviewBtn.textContent = "▼ " + translation.tablePreview;
  }
}

function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() =>
    Array(a.length + 1).fill(null)
  );
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

function fuzzyMatch(str1, str2, threshold = 2) {
  if (!str1 || !str2) return false;
  const distance = levenshteinDistance(str1, str2);
  return distance <= threshold || str1.includes(str2) || str2.includes(str1);
}

function displayLiveResults(csvText, claim, answer, relevantCells) {
  const lang = document.getElementById("liveLanguageSelect").value;
  const translation = translationDict[lang] || translationDict["en"];

  const liveResultsEl = document.getElementById("liveResults");
  if (liveResultsEl) {
    liveResultsEl.style.display = "block";
  }
  const liveClaimList = document.getElementById("liveClaimList");
  if (liveClaimList) {
    liveClaimList.style.display = "block";
    liveClaimList.innerHTML = "";
    const claimDisplay = document.createElement("div");
    claimDisplay.className = "claim-display";
    claimDisplay.textContent = `"${claim}"`;
    liveClaimList.appendChild(claimDisplay);
    const verdictDiv = document.createElement("div");
    verdictDiv.className = "final-verdict " + (answer === "TRUE" ? "true" : "false");
    const verdictText = answer === "TRUE" ? translation.trueLabel : translation.falseLabel;
    verdictDiv.textContent = verdictText.toUpperCase();
    liveClaimList.appendChild(verdictDiv);
  }

  renderLivePreviewTable(csvText, relevantCells);

  const previewContainer = document.getElementById("livePreviewTableContainer");
  if (previewContainer && previewContainer.classList.contains("collapsed")) {
    previewContainer.classList.remove("collapsed");
    const togglePreviewBtn = document.getElementById("toggleLivePreviewTableBtn");
    if (togglePreviewBtn) {
      togglePreviewBtn.textContent = "▲ " + translation.tablePreview;
    }
  }
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
  let candidates = [];
  let idx = 0;
  while (true) {
    const start = rawResponse.indexOf("{", idx);
    if (start === -1) break;
    let braceCount = 0;
    let end = -1;
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
    if (end !== -1) {
      const candidate = rawResponse.substring(start, end + 1);
      candidates.push(candidate);
      idx = end + 1;
    } else {
      break;
    }
  }
  
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed && ("answer" in parsed) && ("relevant_cells" in parsed)) {
        return parsed;
      }
    } catch (e) {
    }
  }
  
  const lowerResponse = rawResponse.toLowerCase();
  if (lowerResponse.includes("true")) {
    return { answer: "TRUE", relevant_cells: [] };
  } else if (lowerResponse.includes("false")) {
    return { answer: "FALSE", relevant_cells: [] };
  } else {
    return { answer: "FALSE", relevant_cells: [] };
  }
}

function separateThinkFromResponse(rawText, model) {
  const thinkTags = getThinkingTagsForModel(model);
  const thinkRegex = new RegExp(`${thinkTags.start}([\\s\\S]*?)${thinkTags.end}`, 'i');
  const match = rawText.match(thinkRegex);
  let thinkContent = "";
  let remainder = rawText;
  if (match) {
    thinkContent = match[1].trim();
    remainder = rawText.replace(thinkRegex, "").trim();
  }
  return { think: thinkContent, noThink: remainder };
}

function getThinkingTagsForModel(model) {
  switch (model) {
    case "exaone-deep":
      return { start: "<thought>", end: "</thought>" };
    case "deepseek-r1:latest":
      return { start: "<think>", end: "</think>" };
    case "cogito":
      return { start: "<think>", end: "</think>" };
    default:
      return { start: "<think>", end: "</think>" };
  }
}

function copyToClipboard(btn) {
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
  const modelOptions = document.querySelectorAll(".model-option");
  const currentModelNameEl = document.getElementById("currentModelName");
  const thinkingOptionDiv = document.getElementById("thinkingOption");
  const modelSelectorBtn = document.getElementById("modelSelectorBtn"); // Get the button
  const buttonBubble = modelSelectorBtn.querySelector('.model-param-bubble'); // Get the bubble in the button

  // Define models that support multiple languages
  const multilingualModels = ["cogito", "gemma3"];
  let firstAvailableModelValue = null;
  let currentSelectionDisabled = false;
  const currentSelectedValue = modelSelect.value;

  // --- 1. Update hidden select and check current selection ---
  for (const option of modelSelect.options) {
    const modelValue = option.value;
    const isMultilingual = multilingualModels.includes(modelValue);
    const isDisabled = selectedLanguage !== "en" && !isMultilingual;
    option.disabled = isDisabled;

    if (!isDisabled && !firstAvailableModelValue) {
      firstAvailableModelValue = modelValue; // Track the first available model
    }
    if (modelValue === currentSelectedValue && isDisabled) {
      currentSelectionDisabled = true; // Mark if the current selection is now disabled
    }
  }

  // --- 2. Update visible modal options ---
  modelOptions.forEach(opt => {
    const modelValue = opt.getAttribute("data-model");
    const isMultilingual = multilingualModels.includes(modelValue);
    const isDisabled = selectedLanguage !== "en" && !isMultilingual;
    if (isDisabled) {
      opt.classList.add("disabled");
    } else {
      opt.classList.remove("disabled");
    }
  });

  // --- 3. Handle case where current selection becomes disabled ---
  if (currentSelectionDisabled && firstAvailableModelValue) {
    modelSelect.value = firstAvailableModelValue; // Switch to the first available model
    // Update the button text and bubble based on the new selection
    const newSelectedOptionDiv = document.querySelector(`.model-option[data-model="${firstAvailableModelValue}"]`);
    if (newSelectedOptionDiv) {
        const headerText = newSelectedOptionDiv.querySelector('.model-option-header').textContent.replace(/\s*\d+b\s*$/, '').trim();
        const paramBubble = newSelectedOptionDiv.querySelector('.model-param-bubble');
        currentModelNameEl.textContent = headerText;
        if (buttonBubble && paramBubble) {
            buttonBubble.textContent = paramBubble.textContent;
            buttonBubble.style.display = 'inline-block';
        } else if (buttonBubble) {
            buttonBubble.textContent = '';
            buttonBubble.style.display = 'none';
        }
    }
    // Trigger change event to update thinking option etc.
    modelSelect.dispatchEvent(new Event('change'));
  } else {
    // Ensure the button bubble is correctly displayed for the current valid selection
    const currentSelectedOptionDiv = document.querySelector(`.model-option[data-model="${modelSelect.value}"]`);
     if (currentSelectedOptionDiv) {
         const paramBubble = currentSelectedOptionDiv.querySelector('.model-param-bubble');
         if (buttonBubble && paramBubble) {
             buttonBubble.textContent = paramBubble.textContent;
             buttonBubble.style.display = 'inline-block';
         } else if (buttonBubble) {
             buttonBubble.textContent = '';
             buttonBubble.style.display = 'none';
         }
     }
  }

   validateLiveCheckInputs();
}

async function processImageViaBackend(file) {
  const engine = document.getElementById("ocrEngineSelect").value;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("engine", engine);
  formData.append("model", "granite3.2-vision");

  ocrAbortController = new AbortController();
  try {
    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
      signal: ocrAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OCR API response error:", response.status, errorText);
      throw new Error(`OCR failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.csv_text) {
      throw new Error("No csv_text returned from OCR API");
    }
    return data.csv_text;
  } catch (error) {
    console.error("Error in processImageViaBackend:", error);
    throw error;
  }
}

document.getElementById("uploadImageBtn").addEventListener("click", function() {
  document.getElementById("imageUpload").click();
});

document.getElementById("imageUpload").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (file) {
    const loadingModal = document.getElementById("loadingModal");
    loadingModal.style.display = "flex";
    const imagePreview = document.getElementById("imagePreview");
    const url = URL.createObjectURL(file);
    imagePreview.innerHTML = `
      <span class="close-preview">×</span>
      <img src="${url}" alt="Uploaded Image Preview" style="cursor: pointer;">
    `;
    imagePreview.style.display = "block";
    
    const previewImg = imagePreview.querySelector("img");
    if (previewImg) {
      previewImg.addEventListener("click", function() {
        var modal = new tingle.modal({
          footer: false,
          stickyFooter: false,
          closeMethods: ['overlay', 'escape'],
          closeLabel: "Close",
          cssClass: ['custom-modal']
        });
        modal.setContent('<img src="' + url + '" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">');
        modal.open();
      });
    }
    
    processImageViaBackend(file)
      .then(csvText => {
        loadingModal.style.display = "none";
        const inputTableEl = document.getElementById("inputTable");
        inputTableEl.value = csvText;
        renderLivePreviewTable(csvText, []);
        validateLiveCheckInputs();
      })
      .catch(err => {
        loadingModal.style.display = "none";
        console.error("OCR processing error:", err);
        if (!err.message.toLowerCase().includes("aborted")) {
          alert("Failed to process the uploaded image: " + err.message);
        }
      })
      .finally(() => {
        e.target.value = "";
      });
  }
});

function updateTranslations() {
  const lang = document.getElementById("liveLanguageSelect").value; // Use hidden select value
  const translation = translationDict[lang] || translationDict["en"];

  // Update language selector button text
  const currentLanguageNameEl = document.getElementById("currentLanguageName");
  const currentLangOptionHeader = document.querySelector(`.language-option[data-lang="${lang}"] .language-option-header`);
  if (currentLanguageNameEl && currentLangOptionHeader) {
      currentLanguageNameEl.textContent = currentLangOptionHeader.textContent;
  } else if (currentLanguageNameEl && liveLanguageSelect.options[liveLanguageSelect.selectedIndex]) {
      // Fallback if the visible option isn't found (shouldn't happen often)
      currentLanguageNameEl.textContent = liveLanguageSelect.options[liveLanguageSelect.selectedIndex].text;
  }

  // Update model descriptions in the modal
  const modelOptions = document.querySelectorAll(".model-option");
  modelOptions.forEach(opt => {
    const modelValue = opt.getAttribute("data-model");
    const descEl = opt.querySelector(".model-option-desc");
    if (descEl) {
      let translationKey;
      switch (modelValue) {
        case "phi4":
          translationKey = "phi4Desc";
          break;
        case "cogito":
          translationKey = "cogitoDesc";
          break;
        case "deepseek-r1:latest":
          translationKey = "deepseekDesc";
          break;
        case "gemma3":
          translationKey = "gemma3Desc";
          break;
        default:
          translationKey = null;
      }
      if (translationKey && translation[translationKey]) {
        descEl.textContent = translation[translationKey];
      }
    }
  });


  // ... rest of updateTranslations function updating other elements ...
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

  const uploadImageBtn = document.getElementById("uploadImageBtn");
  if (uploadImageBtn) uploadImageBtn.textContent = translationDict[lang].uploadImageBtn;

  const tesseractEngine = document.getElementById("tesseractEngine");
  if (tesseractEngine) tesseractEngine.textContent = translationDict[lang].tesseractEngine;

  const ollamaEngine = document.getElementById("ollamaEngine");
  if (ollamaEngine) ollamaEngine.textContent = translationDict[lang].ollamaEngine;

  const processingImage = document.getElementById("processingImage");
  if (processingImage) processingImage.textContent = translationDict[lang].processingImage;

  const mayTakeSeconds = document.getElementById("mayTakeSeconds");
  if (mayTakeSeconds) mayTakeSeconds.textContent = translationDict[lang].mayTakeSeconds;

  const toggleLiveMetaInfoBtn = document.getElementById("toggleLiveMetaInfoBtn");
  if (toggleLiveMetaInfoBtn) {
    const isCollapsed = document.getElementById("liveTableMetaInfo").classList.contains("collapsed");
    toggleLiveMetaInfoBtn.textContent = `${isCollapsed ? "▼" : "▲"} ${translation.tableDetails}`;
  }

  const toggleLivePreviewTableBtn = document.getElementById("toggleLivePreviewTableBtn");
  if (toggleLivePreviewTableBtn) {
    const isCollapsed = document.getElementById("livePreviewTableContainer").classList.contains("collapsed");
    toggleLivePreviewTableBtn.textContent = `${isCollapsed ? "▼" : "▲"} ${translation.tablePreview}`;
  }

  // Update live legends if visible
  const liveHighlightLegend = document.getElementById("full-highlight-legend-live");
  if (liveHighlightLegend && liveHighlightLegend.style.display !== "none") {
    liveHighlightLegend.innerHTML = `<span class="highlight-legend"></span> ${translation.modelHighlightedCells}`;
  }

  const liveEntityLegend = document.getElementById("full-entity-highlight-legend-live");
  if (liveEntityLegend && liveEntityLegend.style.display !== "none") {
    liveEntityLegend.innerHTML = `<span class="entity-highlight-legend"></span> ${translation.entityLinkedCells}`;
  }

  // Update precomputed legends if visible
  const precomputedHighlightLegend = document.getElementById("full-highlight-legend-precomputed");
  if (precomputedHighlightLegend && precomputedHighlightLegend.style.display !== "none") {
    precomputedHighlightLegend.innerHTML = `<span class="highlight-legend"></span> ${translation.modelHighlightedCells}`;
  }

  const precomputedEntityLegend = document.getElementById("full-entity-highlight-legend-precomputed");
  if (precomputedEntityLegend && precomputedEntityLegend.style.display !== "none") {
    precomputedEntityLegend.innerHTML = `<span class="entity-highlight-legend"></span> ${translation.entityLinkedCells}`;
  }


  // Claim Section
  const claimHeading = document.querySelector(".claim-input-group h3");
  if (claimHeading) claimHeading.textContent = translationDict[lang].enterClaim;

  const inputClaimPlaceholder = document.getElementById("inputClaim");
  if (inputClaimPlaceholder) inputClaimPlaceholder.placeholder = translationDict[lang].inputClaimPlaceholder;

  const existingClaimsWrapperLabel = document.querySelector("#existingClaimsWrapper label");
  if (existingClaimsWrapperLabel) existingClaimsWrapperLabel.textContent = translationDict[lang].existingClaimsWrapperLabel;

  // Update the label for passing the table title
  const passTableTitleLabel = document.getElementById("includeTableTitleInPromptLabel"); // Correct ID for the label
  if (passTableTitleLabel) {
    passTableTitleLabel.textContent = translation.passTableTitleToModel; // Use updated translation key
  }

  // Update the placeholder for the table title input
  const tableTitleInput = document.getElementById("tableTitleInput");
  if (tableTitleInput) {
    tableTitleInput.placeholder = translation.tableTitlePlaceholder; // Use new translation key
  }
  // Live Check Section
  const runLiveCheckBtn = document.getElementById("runLiveCheck");
  if (runLiveCheckBtn) runLiveCheckBtn.textContent = translationDict[lang].runLiveCheckBtn;

  // Disclaimer
  const aiDisclaimer = document.querySelector("#aiDisclaimer");
  if (aiDisclaimer) aiDisclaimer.textContent = translationDict[lang].aiDisclaimer;
  const liveCheckInfo = document.querySelector("#liveCheckInfo");
  if (liveCheckInfo) liveCheckInfo.textContent = translationDict[lang].liveCheckInfo;

  const enableThinkingLabel = document.querySelector('#thinkingOption label[for="enableThinkingCheck"]');
  if (enableThinkingLabel) enableThinkingLabel.textContent = translation.enableThinkingLabel;
}
