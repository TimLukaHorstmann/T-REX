<h1 align="left">
  <img src="frontend/images/t-rex_logo.png" alt="T-REX Logo" style="height: 65px; vertical-align: bottom;">
  T-REX: Table - Refute or Entail eXplainer
</h1>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit-blue.svg)](https://t-rex.r2.enst.fr/)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/TimLukaHorstmann/T-REX/graphs/commit-activity) 
[![License: Custom NC](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Ollama](https://img.shields.io/badge/Ollama-14a06f?logo=ollama&logoColor=white)](https://ollama.com/)
[![uv](https://img.shields.io/badge/uv-000000)](https://github.com/astral-sh/uv)
[![arXiv](https://img.shields.io/badge/arXiv-2508.14055-b31b1b.svg)](https://arxiv.org/abs/2508.14055)


**T-REX** (**T**able - **R**efute or **E**ntail e**X**plainer) is an interactive tool designed for intuitive, transparent, and live fact-checking of tabular data. Leveraging state-of-the-art instruction-tuned reasoning Large Language Models (LLMs), T-REX dynamically analyzes claims against tables, clearly indicating entailment or refutation, along with visual explanations highlighting relevant tble cells.

## 🚀 Key Features

- **Live Fact-Checking**: Paste or upload CSV tables or images (OCR), or select from the TabFact dataset.
- **Multiple LLMs:** Support for multiple models including Phi-4, Cogito, DeepSeek-R1, and Gemma3.
- **Visual Explainability:** Highlights cells identified by the model as relevant for the verification.
- **Precomputed Results Exploration:** Explore results from various LLMs on the TabFact benchmark dataset with performance metrics and intuitive visualizations.
- **Multilingual Support:** English, French, German, Spanish, Portuguese, Chinese, Arabic, Russian  

## 🖥️ Demo

T-REX got accepted at [ECML-PKDD 2025](https://ecmlpkdd-storage.s3.eu-central-1.amazonaws.com/preprints/2025/demos/preprint_ecml_pkdd_2025_demos_1689.pdf).

**Experience the live demo here: [https://t-rex.r2.enst.fr/](https://t-rex.r2.enst.fr/)**

🎬 **Watch the video demo:**  
[![Watch the video](https://img.youtube.com/vi/HHIxVCOT8X0/0.jpg)](https://www.youtube.com/watch?v=HHIxVCOT8X0)

## 📋 Usage

### Live Table Fact-Checking:
   - Input custom CSV-formatted tables directly or via file/image upload (with OCR support).
   - Enter custom claims or select pre-existing claims from the TabFact dataset.
   - Real-time inference with streaming outputs from supported LLMs.

### Precomputed Results:
   - Analyze comprehensive benchmark results from various models (e.g., DeepSeek‑R1, Gemma3, Llama, etc.) on the TabFact dataset.
   - Detailed visual analytics, including confusion matrices and performance summaries.

## 🔧 Technology Stack

- **Frontend:** HTML, CSS, JavaScript, Plotly.js, Chart.js, Choices.js
- **Backend:** Python, FastAPI, Uvicorn
- **Inference Engine:** Ollama
- **LLMs:** Phi-4 (14B), Cogito v1 Preview (8B), DeepSeek-R1-Distill-Qwen-7B (7B), and Gemma 3 (4B)
- **OCR:** Tesseract, Granite3.2-vision (Ollama) 

## 📚 Dataset & Credits

T-REX uses the [**TabFact**](https://github.com/wenhuchen/Table-Fact-Checking) dataset by Wenhuchen et al. For more details, please refer to the original paper:

> **TabFact: A Large-scale Dataset for Table-based Fact Verification**  
> Wenhuchen et al., ICLR 2020.  
> [https://github.com/wenhuchen/Table-Fact-Checking](https://github.com/wenhuchen/Table-Fact-Checking)

## 🚀 Getting Started

### Prerequisites
1.  **Python:** 3.10+ recommended.
2.  **uv:** Fast Python package manager and runner.
    - Install with pipx or Homebrew:
      ```bash
      pipx install uv
      # or
      brew install uv
      ```
3.  **Ollama:** Install from [https://ollama.com/](https://ollama.com/).
    - Pull the required models:
      ```bash
      ollama pull phi4
      ollama pull deepseek-r1:latest
      ollama pull gemma3
      ollama pull cogito
      ollama pull granite3.2-vision # For Ollama OCR
      ```
    - Ensure the Ollama service is running.
4. **Tesseract OCR** (Optional): if you plan to use Tesseract for OCR.
    - Install the Tesseract binary:
      - macOS: `brew install tesseract`
      - Ubuntu/Debian: `sudo apt-get install tesseract-ocr`
    - Ensure it’s discoverable: `which tesseract` and `tesseract --version`


### Installation & Local Setup
1.  **Clone the repository:**
    ```bash
    git clone https://github.com/TimLukaHorstmann/T-REX.git
    cd T-REX
    ```
2.  **Sync dependencies (first time only):**
    ```bash
    uv sync
    ```

3.  **Run Everything (Single Command, Dev):**
    *   Ensure the Ollama service (with required models) is running (see Prerequisites).
    *   From the project root, run:
        ```bash
        ./dev.sh
        ```
    *   Then open: `http://localhost:8000`

    Notes:
    - The FastAPI app also serves the frontend from `frontend/`, so `/` loads the UI and `/api/*` serves backend endpoints. Dataset assets are served under `/static/data/*`.
    - Live reload is enabled; changes under `backend/api` auto-reload the server.

4.  **Alternative (Separate Servers):**
    If you prefer running frontend and backend separately:
    *   Backend:
        ```bash
        uvicorn main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend/api
        ```
    *   Frontend (new terminal):
        ```bash
        cd frontend && python3 -m http.server 8080
        ```
    This requires a dev proxy to avoid CORS and path issues because the frontend fetches relative `/api/*` paths. The recommended approach is the single-command dev server above.

### OCR Options
- Recommended: **Ollama Granite 3.2 Vision** (pull `granite3.2-vision`). In the UI, select OCR engine “Ollama” + model `granite3.2-vision`.
- Optional: **Tesseract OCR** (system binary required on PATH)
  - Install the Tesseract binary:
    - macOS: `brew install tesseract`
    - Ubuntu/Debian: `sudo apt-get install tesseract-ocr`
  - Ensure it’s discoverable: `which tesseract` and `tesseract --version`
  - Advanced: If tesseract is not on PATH, set environment variable `TESSERACT_CMD` to the full path (e.g., `/opt/homebrew/bin/tesseract`).
  - Python pieces (`pytesseract`, `pillow`) are already listed in `pyproject.toml` and installed via `uv sync`.

**Note on Deployment:**
The steps above describe a basic local development setup. For deploying T-REX to a server (like the live demo at `t-rex.r2.enst.fr`), you would typically:
*   Run the FastAPI backend using a production-grade ASGI server like `uvicorn` with `gunicorn` workers.
*   Set up a reverse proxy (e.g., Nginx or Caddy) to handle HTTPS, serve static frontend files efficiently, and forward API requests to the backend application.
*   Manage the backend process using a process manager (e.g., `systemd`, `supervisor`) to ensure it runs reliably.
*   Ensure the Ollama service is appropriately configured and accessible by the backend on the server.

These production deployment steps are environment-specific and beyond the scope of this basic setup guide.

## 📖 Citation

If you use **T-REX** in academic work, please cite our ECML-PKDD 2025 demo paper:

```bibtex
@inproceedings{Horstmann2025TREX,
  author    = {Tim~Luka Horstmann and Baptiste Geisenberger
               and Mehwish Alam},
  title     = {{T\mbox{-}REX}: Table - Refute or Entail eXplainer},
  booktitle = {Machine Learning and Knowledge Discovery in Databases.
               Demo Track, European Conference, ECML~PKDD 2025, Porto,
               Portugal, September 15–19 2025, Proceedings},
  series    = {Lecture Notes in Computer Science},
  volume    = {**to appear**},
  year      = {2025},
  publisher = {Springer, Cham},
  pages     = {**to appear**},
  doi       = {**to appear**},
  url       = {**to appear**}
}
```

## 📄 License

This software is released under a **Custom Non-Commercial License**.  
It is free to use for **research, academic, or personal purposes**.

> 🛑 **Commercial use is prohibited** without **explicit written permission** from the authors.

To inquire about commercial licensing, please contact:  
[**tim.horstmann@ip-paris.fr**](mailto:tim.horstmann@ip-paris.fr)

See the [LICENSE](./LICENSE) file for full terms.

## 📝 Authors

Institut Polytechnique de Paris

- [Tim Luka Horstmann](https://horstmann.tech)
- Baptiste Geisenberger
- [Mehwish Alam](https://sites.google.com/view/mehwish-alam/home)

---

© 2025 T-REX: Table - Refute or Entail eXplainer

<br>
<br>

---

## 🔍 How does T-REX compare?

Here's a comparison of T-REX with some other comparable table fact-checking and question-answering tools:

| Tool (link) | Year | Live Demo / UI | Real-time* | Table Upload | OCR / Image | Evidence Viz† | LLM Backend | Code Open? |
|-------------|:----:|:--------------:|:----------:|:------------:|:-----------:|:-------------:|:-----------:|:----------:|
| **T-REX (ours)**<br>[Demo](https://t-rex.r2.enst.fr/) | 2025 | ✅ [Live](https://t-rex.r2.enst.fr/) | ✅ streaming | ✅ CSV / text / image (OCR) | ✅ Tesseract & Granite 3.2 | ✅ cell highlighting & reasoning stream | Phi-4, DeepSeek-R1, Cogito v1, Gemma3 | ✅ |
| **OpenTFV**<br>[Paper](https://doi.org/10.1145/3514221.3520163) | 2022 | ⚠️ Prototype UI (conference demo; no public deployment) | ✅ immediate synchronous | ✅ CSV, JSON, PDF | ❌ | ✅ NL interp. & entity linking | TAPAS & LPA | ❌ |
| **Aletheia**<br>[Paper](https://doi.org/10.1145/3654777.3676359) | 2024 | ⚠️ No public demo available | ⚠️ async | ❌ fixed datasets only | ❌ | ✅ interactive tables & visualizations | Proprietary LLMs GPT-3.5/4  | ❌ |
| **HF Space (J. Simon)**<br>[Demo](https://huggingface.co/spaces/juliensimon/table_questions) | 2023 | ⚠️ HF Space (runtime errors) | ✅ immediate | ✅ CSV upload | ❌ | ❌ | TAPAS | ✅ |
| **RePanda**<br>[Paper](https://arxiv.org/abs/2503.11921) | 2025 | ❌ CLI only | ❌ offline | ✅ via Pandas API | ❌ | ✅ executable query scripts | Llama-7B | ✅ |
| **TabVer**<br>[Paper](https://arxiv.org/abs/2411.01093) | 2024 | ❌ CLI only | ❌ offline | ✅ code-based ingestion | ❌ | ✅ natural-logic proofs | LLM-generated expressions | ✅ |
| **TART**<br>[Paper](https://arxiv.org/abs/2306.07536) | 2023 | ❌ CLI only | ❌ offline | ✅ | ❌ | ❌ | Plugin-based reasoning | ✅ |

\* **Real-time** = immediate verdict; “stream” means token-level reasoning.  
† **Evidence Viz** = visual or structured justification beyond a plain label.

---

## 📊 Model Performance Overview

Performance comparison of different models on the TabFact dataset as reported by [Chen, 2025](https://github.com/wenhuchen/Table-Fact-Checking) and [Meta AI](https://paperswithcode.com/sota/table-based-fact-verification-on-tabfact) or evaluated as part of this work.

| Model | Test Accuracy (%) | Validation Accuracy (%) | Year |
|-------|-------------------|-------------------------|------|
| ARTEMIS-DA [Hussain et al., 2024](http://arxiv.org/abs/2412.14146) | 93.1 (on test-small) | - | 2024 |
| Dater [Ye et al., 2023](http://arxiv.org/abs/2301.13808) | 93.0 (on test-small), 85.6 (on test-all) | - | 2023 |
*Human Performance: ≈ 92% [Chen et al., 2020](https://openreview.net/forum?id=rkeJRhNYDH)*
| PASTA [Gu et al., 2022](https://aclanthology.org/2022.emnlp-main.331) | 89.3 | 89.2 | 2022 |
| Phi4 (Zero Shot) (Ours) | 88.9 (on test-all) | - | 2024 |
| UL-20B [Tay et al., 2023](http://arxiv.org/abs/2205.05131) | 87.1 |  | 2022 |
| Chain-of-Table [Wang et al., 2024](http://arxiv.org/abs/2401.04398) | 86.6 | - | 2024 |
| Binder [Cheng et al., 2023](http://arxiv.org/abs/2210.02875) | 86.0 | - | 2022 |
| Tab-PoT [Xiao et al., 2024](http://arxiv.org/abs/2406.10382) | 85.8 | - | 2024 |
| Phi4 (RAG Approach) (Ours) | 85.7 | - | 2024 |
| ReasTAP-Large [Zhao et al., 2022](http://arxiv.org/abs/2210.12374) | 84.9 | 84.6 | 2022 |
| TAPEX-Large [Liu et al., 2022](http://arxiv.org/abs/2107.07653) | 84.2 | 84.6 | 2021 |
| T5-3b (UnifiedSKG) [Xie et al., 2022](http://arxiv.org/abs/2201.05966) | 83.7 | 84.0 | 2022 |
| DecompTAPAS [Yang et al., 2021](https://aclanthology.org/2021.findings-emnlp.90/) | 82.7 | 82.7 | 2021 |
| Salience-aware TAPAS [Wang et al., 2021](https://arxiv.org/abs/2109.04053) | 82.1 | 82.7 | 2021 |
| Phi4 (Code Generation) (Ours) | 81.9 | - | 2024 |
| TAPAS-Large classifier with Counterfactual + Synthetic pre-training [Eisenschlos et al., 2020](http://arxiv.org/abs/2010.00571) | 81.0 | 81.0 | 2020 |
| ProgVGAT [Yang et al., 2021](http://arxiv.org/abs/2010.03084) | 74.4 | 74.9 | 2020 |
| SAT [Zhang et al., 2020](https://aclanthology.org/2020.emnlp-main.126) | 73.2 | 73.3 | 2020 |
| HeterTFV [Shi et al., 2020](https://aclanthology.org/2020.coling-main.466) | 72.3 | 72.5 | 2020 |
| LFC (Seq2Action) [Zhong et al., 2020](https://aclanthology.org/2020.acl-main.539/) | 71.7 | 71.8 | 2020 |
| LFC (LPA) [Zhong et al., 2020](https://aclanthology.org/2020.acl-main.539/) | 71.6 | 71.7 | 2020 |
| Num-Net [Ran et al., 2019](http://arxiv.org/abs/1910.06701) | 72.1 | 72.1 | 2019 |
| LPA-Ranking w/ Discriminator (Caption) [Chen et al., 2020](https://openreview.net/forum?id=rkeJRhNYDH) | 65.3 | 65.1 | 2020 |
| Table-BERT-Horizontal-T+F-Template [Chen et al., 2020](https://openreview.net/forum?id=rkeJRhNYDH) | 65.1 | 66.1 | 2020 |
| BERT classifier w/o Table [Chen et al., 2020](https://openreview.net/forum?id=rkeJRhNYDH) | 50.5 | 50.9 | 2020 |
