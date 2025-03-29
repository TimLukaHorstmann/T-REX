<h1 align="left">
  <img src="frontend/images/t-rex_logo.png" alt="T-REX Logo" style="height: 65px; vertical-align: bottom;">
  T-REX: Table - Refute or Entail eXplainer
</h1>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit-blue.svg)](https://t-rex.r2.enst.fr/)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/naptha/tesseract.js/graphs/commit-activity)
[![License: Custom NC](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)


**T-REX** (**T**able - **R**efute or **E**ntail e**X**plainer) is an interactive tool designed for intuitive, transparent, and live fact-checking of tabular data. Leveraging advanced Language Models (LLMs), T-REX dynamically analyzes claims against tables, clearly indicating entailment or refutation, along with visual explanations highlighting relevant table cells.

## 🚀 Key Features

- **Live Fact-Checking**: Paste or upload your own tables in CSV format, upload images, or select tables directly from the TabFact dataset.
- **Multiple LLM Backends:** Support for multiple models including DeepSeek-R1, Gemma, Phi3, and Llama3.
- **Visual Explainability:** Highlights cells identified by the model and entity-linked cells from the original TabFact dataset.
- **Precomputed Results Exploration:** Explore results from various LLMs on the TabFact benchmark dataset with performance metrics and intuitive visualizations.
- **Multilingual Support:** Fact-check in English, French, and German.

## 🖥️ Demo

T-REX is presented as a demo paper at [ECML-PKDD 2025 Demo Track](https://ecmlpkdd.org/2025/submissions-demo-track/), showcasing its effectiveness and utility in practical NLP-driven applications.

**Experience the live demo here: [https://t-rex.r2.enst.fr/](https://t-rex.r2.enst.fr/)**

## 🎯 Motivation

Existing table fact-checking solutions often lack intuitive interaction and transparency regarding their internal reasoning. T-REX addresses this gap by providing users immediate, explainable insights into why a claim is entailed or refuted by tabular data, facilitating both trust and usability in practical scenarios.

## 📋 Usage

### Live Fact-Checking

- Select from multiple LLMs, input or upload a CSV table (or image for OCR), and submit your claim.
- Receive live results and visual explanations indicating entailment or refutation.

## 🖥 Demo

T-REX offers three primary interaction modes:

1. **Live Table Fact-Checking:**
   - Input custom CSV-formatted tables directly or via file/image upload (with OCR support).
   - Enter custom claims or select pre-existing claims from the TabFact dataset.
   - Real-time inference with streaming outputs from supported LLMs.

2. **Precomputed Results:**
   - Analyze comprehensive benchmark results from various models (e.g., DeepSeek‑R1, Gemma3, Llama, etc.) on the TabFact dataset.
   - Detailed visual analytics, including confusion matrices and performance summaries.

3. **Report View:**
   - View in-depth project insights and methodology explanations via a built-in PDF viewer.

## 🔧 Technology

- **Frontend:** HTML, CSS, JavaScript, Plotly.js, Chart.js, Choices.js
- **Backend:** Ollama API for inference
- **OCR:** Tesseract.js, Ollama OCR
- **Models Supported:** DeepSeek-R1, Gemma3, Phi3, Llama3.2

## 📚 Dataset & Credits

T-REX is built upon the [**TabFact**](https://github.com/wenhuchen/Table-Fact-Checking) dataset and benchmark by Wenhuchen et al. For more details, please refer to the original paper:

> **TabFact: A Large-scale Dataset for Table-based Fact Verification**  
> Wenhuchen et al., ICLR 2020.  
> [https://github.com/wenhuchen/Table-Fact-Checking](https://github.com/wenhuchen/Table-Fact-Checking)

## 📖 Installation & Usage

### Installation

Clone the repository:

```bash
git clone https://github.com/YourUsername/T-REX.git
cd T-REX
```

Install dependencies (if applicable):

```bash
npm install
# or using yarn
yarn install
```

Launch the application (local):

```bash
python -m http.server
# or
open index.html
```

For best results, use a modern web browser (Chrome recommended).

## 📝 How to Use

### Live Fact-Checking
1. Select an LLM model.
2. Enter your table data (via paste, upload, or OCR).
3. Enter your claim or choose from existing examples.
4. Click **Run Live Check** to obtain instant verdicts and visual explanations.

## 📄 Citation

If you use this project, please cite our demo paper (submitted to ECML-PKDD 2025):

```bibtex
@inproceedings{horstmann2025trex,
  title={T-REX: Table - Refute or Entail eXplainer},
  author={Horstmann, Tim Luka and Geisenberger, Baptiste and Alam, Mehwish},
  booktitle={Proceedings of the ECML-PKDD Demo Track},
  year={2025}
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
<br>
<br>

---

### 📊 Model Performance Overview

Performance comparison of different models on the TabFact dataset as reported by [Chen, 2025](https://github.com/wenhuchen/Table-Fact-Checking) and [Meta AI](https://paperswithcode.com/sota/table-based-fact-verification-on-tabfact) or evaluated as part of this work.

| Model | Test Accuracy (%) | Validation Accuracy (%) | Year |
|-------|-------------------|-------------------------|------|
| ARTEMIS-DA [Hussain et al., 2024](http://arxiv.org/abs/2412.14146) | 93.1 | - | 2024 |
| Dater [Ye et al., 2023](http://arxiv.org/abs/2301.13808) | 93.0 | - | 2023 |
*Human Performance: ≈ 92% [Chen et al., 2020](https://openreview.net/forum?id=rkeJRhNYDH)*
| PASTA [Gu et al., 2022](https://aclanthology.org/2022.emnlp-main.331) | 89.3 | 89.2 | 2022 |
| Phi4 (Zero Shot) [Abdin et al., 2024](http://arxiv.org/abs/2412.08905) | 88.9 | - | 2024 |
| UL-20B [Tay et al., 2023](http://arxiv.org/abs/2205.05131) | 87.1 |  | 2022 |
| Chain-of-Table [Wang et al., 2024](http://arxiv.org/abs/2401.04398) | 86.6 | - | 2024 |
| Binder [Cheng et al., 2023](http://arxiv.org/abs/2210.02875) | 86.0 | - | 2022 |
| Tab-PoT [Xiao et al., 2024](http://arxiv.org/abs/2406.10382) | 85.8 | - | 2024 |
| Phi4 (RAG Approach) [Abdin et al., 2024](http://arxiv.org/abs/2412.08905) | 85.7 | - | 2024 |
| ReasTAP-Large [Zhao et al., 2022](http://arxiv.org/abs/2210.12374) | 84.9 | 84.6 | 2022 |
| TAPEX-Large [Liu et al., 2022](http://arxiv.org/abs/2107.07653) | 84.2 | 84.6 | 2021 |
| T5-3b (UnifiedSKG) [Xie et al., 2022](http://arxiv.org/abs/2201.05966) | 83.7 | 84.0 | 2022 |
| DecompTAPAS [Yang et al., 2021](https://aclanthology.org/2021.findings-emnlp.90/) | 82.7 | 82.7 | 2021 |
| Salience-aware TAPAS [Wang et al., 2021](https://arxiv.org/abs/2109.04053) | 82.1 | 82.7 | 2021 |
| Phi4 (Code Generation) [Abdin et al., 2024](http://arxiv.org/abs/2412.08905) | 81.9 | - | 2024 |
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

