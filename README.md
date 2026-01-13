# SOTAChat — Local LLM Literature Reviewer

SOTAChat is a fully client-side research copilot: drop in your PDFs, embed them in the browser, and chat with a lightweight WebLLM model to synthesize a literature review without sending data to a server.

![last-commit](https://img.shields.io/github/last-commit/ISDriss/AICG_Shadertoy?style=flat&logo=git&logoColor=white&color=0080ff)
![repo-top-language](https://img.shields.io/github/languages/top/ISDriss/AICG_Shadertoy?style=flat&color=0080ff)
![repo-language-count](https://img.shields.io/github/languages/count/ISDriss/AICG_Shadertoy?style=flat&color=0080ff)

Built with:
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E.svg?style=flat&logo=JavaScript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26.svg?style=flat&logo=html5&logoColor=white)

## Live Demo

- GitHub Pages: **https://isdriss.github.io/SOTAChat/**
- Best viewed in a WebGPU-capable Chromium browser.

## Features

- PDF ingestion with drag-and-drop or file picker (pdf.js for extraction).
- Text chunking (500 chars, 100-char overlap) and embeddings via Transformers.js (`Xenova/all-MiniLM-L6-v2`).
- Custom in-memory vector store with cosine-similarity retrieval.
- WebLLM chat interface with model selection (Phi-3, Llama-3, MiniCPM), temperature slider, and editable system prompt.
- RAG-aware responses that cite chunk IDs; chat history retained per session.
- Modern glassmorphism UI with sidebars for files and model controls.

## Getting Started (Local)

1) Install dependencies: none — everything loads from CDNs.  
2) Serve the folder (required for ES modules):
   ```bash
   cd /home/ilian/GitProjects/SOTAChat
   python -m http.server 8000
   ```
3) Open `http://localhost:8000` in a WebGPU-enabled Chromium browser (Chrome/Edge latest).  
4) If you see SharedArrayBuffer/COOP/COEP warnings, use a local dev server that sets those headers or enable an isolation-exempt localhost profile.

## Usage

1) Choose a model in the right panel; wait for “ready”.  
2) Drag/drop PDFs into the left panel (or click Browse).  
3) Embed the pdf in the chat by clicking "insert".
3) Ask questions in the composer; responses cite chunk IDs from your PDFs.  
4) Adjust temperature or edit the system prompt to steer tone/constraints.  
5) Use the “Insert/Remove” button on a file card to attach/detach its chunks.

## Architecture

- **Frontend:** Vanilla HTML/CSS/JS with Tailwind via CDN.  
- **Inference:** WebLLM (browser GPU) for chat; Transformers.js for embeddings.  
- **RAG Pipeline:** pdf.js → text → sliding-window chunking → embeddings → cosine search → context injection into chat prompt.  
- **State:** In-memory vector store; no backend or persistence.

## Deployment

- Static hosting: GitHub Pages at `https://isdriss.github.io/SOTAChat/`.  
- To redeploy: build not required; push to `main` and ensure `index.html` is served as a SPA entry point.

## Current Status vs Project Goals

- RAG engine: implemented (PDF extraction, chunking, embeddings, cosine search).  
- Chat interface: implemented with model loading, history, temperature, and system prompt.  
- UI citations: chunk IDs are referenced in answers; visual citation indicators pending.  
- Docs/deployment: README updated; needs screenshot/GIF of the interface + generated review.  
- Audio (voice): not started.

## Notes

- All processing stays in the browser; PDFs are not uploaded to a server.  
- Performance depends on your GPU/driver and the chosen model size.
