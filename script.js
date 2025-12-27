document.addEventListener('DOMContentLoaded', () => {
    // html elements
    const root = document.documentElement;
    const workspacePanel = document.getElementById('workspacePanel');
    const controlPanel = document.getElementById('controlPanel');
    const leftToggle = document.getElementById('leftToggle');
    const rightToggle = document.getElementById('rightToggle');
    const peekLeft = document.getElementById('peekLeft');
    const peekRight = document.getElementById('peekRight');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileBrowse = document.getElementById('fileBrowse');
    const fileList = document.getElementById('fileList');
    const chatFeed = document.getElementById('chatFeed');
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const attachButton = document.getElementById('attachButton');
    const activeModel = document.getElementById('activeModel');
    const modelMeta = document.getElementById('modelMeta');
    const modelGrid = document.getElementById('modelGrid');
    const modelStatus = document.getElementById('modelStatus');
    const historyList = document.getElementById('historyList');
    const tempSlider = document.getElementById('tempSlider');

    // vars
    const sizes = { left: 320, right: 320, collapsed: 64 };
    const fileState = new Map();
    const chatLog = [];
    let vectorStore = [];
    let chunkId = "";
    let appConfig = null;
    let webllmModule = null;
    let transformersModule = null;
    let embedder = null;
    let enginePromise = null;
    let currentModel = null;

    const MODEL_CATALOG = [
        {
            label: 'Phi-3-mini',
            modelId: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
            path: 'https://huggingface.co/mlc-ai/web-llm/resolve/main/phi-3-mini-4k-instruct-q4f16_1-MLC',
            blurb: 'Fast summaries, small context'
        },
        {
            label: 'Llama-3',
            modelId: 'Llama-3-8B-Instruct-q4f16_1-MLC',
            path: 'https://huggingface.co/mlc-ai/web-llm/resolve/main/Llama-3-8B-Instruct-q4f16_1-MLC',
            blurb: 'Long-form analysis & PDF QA'
        },
        {
            label: 'MiniCPM',
            modelId: 'MiniCPM-V-2_6-q4f16_1-MLC',
            path: 'https://huggingface.co/mlc-ai/web-llm/resolve/main/MiniCPM-V-2_6-q4f16_1-MLC',
            blurb: 'Charts & image-aware'
        }
    ];

    const AllMessages = [
        { role: 'assistant', text: 'Drop PDFs on the left to attach them. Pick a model on the right and I will load it here in-browser.' }
    ];

    //#region Setup
    AllMessages.forEach(addMessage);
    renderModelGrid();
    wireExistingFileCards();
    setupPanels();
    setupDropZone();
    setupChatDropTarget();
    setupComposer();
    setupHistory();
    setupTemperature();
    syncLayout();

    // Panels
    function setupPanels() {
        const toggle = (panel) => {
            const isCollapsed = panel.classList.toggle('collapsed');
            const trigger = panel === workspacePanel ? leftToggle : rightToggle;
            trigger?.setAttribute('aria-expanded', (!isCollapsed).toString());
            syncLayout();
        };

        leftToggle?.addEventListener('click', () => toggle(workspacePanel));
        rightToggle?.addEventListener('click', () => toggle(controlPanel));
        peekLeft?.addEventListener('click', () => toggle(workspacePanel));
        peekRight?.addEventListener('click', () => toggle(controlPanel));
    }

    function syncLayout() {
        const leftSize = workspacePanel?.classList.contains('collapsed') ? sizes.collapsed : sizes.left;
        const rightSize = controlPanel?.classList.contains('collapsed') ? sizes.collapsed : sizes.right;
        root.style.setProperty('--left-size', `${leftSize}px`);
        root.style.setProperty('--right-size', `${rightSize}px`);
    }

    // Files
    function wireExistingFileCards() {
        document.querySelectorAll('.file-card').forEach(card => {
            const name = card.dataset.name || 'Untitled.pdf';
            const pages = Number(card.dataset.pages || '1');
            const size = card.dataset.size || '';
            fileState.set(name, { name, pages, size, file: null });
            attachFileInteractions(card, { name, pages, size });
        });
    }

    function setupDropZone() {
        if (!dropZone) return; 
        ['dragenter', 'dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragging');
        }));

        ['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragging');
        }));

        dropZone.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) handleIncomingFiles(files, { alsoAttach: false });
        });

        fileBrowse?.addEventListener('click', () => fileInput?.click());
        attachButton?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleIncomingFiles(files, { alsoAttach: false });
            fileInput.value = '';
        });
    }

    function setupChatDropTarget() {
        if (!chatFeed) return;
        ['dragenter', 'dragover'].forEach(evt => chatFeed.addEventListener(evt, (e) => {
            e.preventDefault();
            chatFeed.classList.add('drop-active');
        }));

        ['dragleave', 'drop'].forEach(evt => chatFeed.addEventListener(evt, (e) => {
            e.preventDefault();
            chatFeed.classList.remove('drop-active');
        }));

        chatFeed.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            const draggedName = e.dataTransfer?.getData('text/plain');
            if (files.length) {
                handleIncomingFiles(files, { alsoAttach: true });
            } else if (draggedName) {
                attachFileToChat(draggedName);
            }
        });
    }

    // History
    function setupHistory() {
        historyList?.addEventListener('click', (event) => {
            const target = event.target.closest('.history-item');
            if (!target) return;
            const title = target.dataset.title || 'Previous chat';
            const snippet = target.dataset.snippet || '';
            addMessage({
                role: 'system',
                text: `Loaded "${title}". ${snippet}`
            });
        });
    }

    // Temperature
    function setupTemperature() {
        tempSlider?.addEventListener('input', () => {
            const value = Number(tempSlider.value) / 100;
            modelMeta.textContent = `temperature · ${value.toFixed(2)}`;
        });
    }

    // Composer and chat
    function setupComposer() {
        messageForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = messageInput?.value.trim();
            if (!text) return;
            addMessage({ role: 'user', text });
            messageInput.value = '';
            await respondToUser(text);
        });
    }
    
    function addMessage({ role, text, track }) {
        const row = document.createElement('div');
        row.className = `message ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (role !== 'system') {
            const tag = document.createElement('span');
            tag.className = 'role-tag';
            tag.textContent = role === 'user' ? 'You' : 'Assistant';
            bubble.appendChild(tag);
        }

        const content = document.createElement('div');
        content.innerText = text;
        bubble.appendChild(content);

        row.appendChild(bubble);
        chatFeed?.appendChild(row);
        chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });

        const shouldTrack = track !== undefined ? track : (role === 'assistant' || role === 'user');
        let logEntry = null;
        if (shouldTrack) {
            logEntry = { role, content: text };
            chatLog.push(logEntry);
        }

        return { row, bubble, content, logEntry };
    }

    async function respondToUser(prompt) {
        if (!enginePromise) {
            const meta = MODEL_CATALOG[0];
            selectModel(meta);
        }
        const placeholder = addMessage({ role: 'assistant', text: 'Loading model…', track: false });
        const engine = await enginePromise;
        if (!engine) {
            placeholder.content.textContent = `(offline) Model not ready.`;
            return;
        }

        if (engine?.chat?.completions?.create) {
            try {
                placeholder.content.textContent = `Running ${currentModel?.label}…`;
                const completion = await engine.chat.completions.create({
                    model: currentModel?.modelId,
                    messages: chatLog.map(mapChatToLLM),
                    stream: false
                });
                const reply = completion?.choices?.[0]?.message?.content || 'No response generated.';
                placeholder.content.textContent = reply;
                chatLog.push({ role: 'assistant', content: reply });
                return;
            } catch (err) {
                console.error('Model inference error', err);
                placeholder.content.textContent = `Model error: ${err?.message || err}`;
                return;
            }
        }
        const fallback = `(offline) I will summarize based on your PDFs and prompt: "${prompt}".`;
        placeholder.content.textContent = fallback;
        chatLog.push({ role: 'assistant', content: fallback });
    }

    //#endregion Setup
    //#region Model management
    function renderModelGrid() {
        if (!modelGrid) return;
        modelGrid.innerHTML = '';
        MODEL_CATALOG.forEach((meta, index) => {
            const label = document.createElement('label');
            label.className = 'model-tile';
            label.innerHTML = `
                <input type="radio" name="model" value="${meta.modelId}" ${index === 0 ? 'checked' : ''}>
                <div>
                    <p class="model-name">${meta.label}</p>
                    <p class="muted">${meta.blurb}</p>
                    <p class="muted meta">${meta.path}</p>
                </div>
                <span class="tag${index === 1 ? ' alt' : ''}">${index === 0 ? 'default' : 'custom'}</span>
            `;
            label.querySelector('input')?.addEventListener('change', () => selectModel(meta));
            modelGrid.appendChild(label);
        });
        if (MODEL_CATALOG[0]) {
            selectModel(MODEL_CATALOG[0]);
        }
    }

    function selectModel(meta) {
        currentModel = meta;
        activeModel.textContent = `Model: ${meta.label}`;
        modelMeta.textContent = `loading ${meta.label}`;
        addMessage({ role: 'system', text: `Switched to ${meta.label}. Loading from ${meta.path}` });
        enginePromise = loadModel(meta);
    }

    async function loadModel(meta) {
        modelStatus.textContent = `Loading ${meta.label}…`;
        try {
            const webllm = await ensureWebLLM();
            const config = await ensureAppConfig(webllm);
            const engine = await webllm.CreateMLCEngine(meta.modelId, {
                appConfig: config,
                initProgressCallback: (report) => {
                    const pct = Math.round((report.progress || 0) * 100);
                    modelStatus.textContent = `Loading ${meta.label}: ${report.text || ''} ${Number.isFinite(pct) ? pct + '%' : ''}`;
                }
            });
            modelStatus.textContent = `${meta.label} ready`;
            modelMeta.textContent = `loaded · ${meta.label}`;
            addMessage({ role: 'system', text: `${meta.label} loaded and ready.` });
            return engine;
        } catch (err) {
            modelStatus.textContent = `Failed to load ${meta.label}: ${err?.message || err}`;
            modelMeta.textContent = `error · ${meta.label}`;
            addMessage({ role: 'system', text: `Model load failed (${meta.label}). Using fallback responses.` });
            console.error('Model load error:', err);
            return null;
        }
    }

    async function ensureWebLLM() {
        if (webllmModule) return webllmModule;
        webllmModule = await import('https://esm.run/@mlc-ai/web-llm');
        return webllmModule;
    }

    async function ensureAppConfig(webllm) {
        if (appConfig) return appConfig;
        const base = structuredClone(webllm?.prebuiltAppConfig || {});
        const list = Array.isArray(base.model_list) ? base.model_list : [];

        // keep existing model metadata (like tokenizer config) but point URLs to HF
        MODEL_CATALOG.forEach(meta => {
            const match = list.find(entry => entry.model_id === meta.modelId);
            const url = ensureTrailingSlash(meta.path);
            if (match) {
                match.model_url = url;
                match.model_lib_url = url;
            } else {
                list.push({
                    model_id: meta.modelId,
                    model_url: url,
                    model_lib_url: url
                });
            }
        });

        base.model_list = list;
        appConfig = base;
        return appConfig;
    }

    function ensureTrailingSlash(url) {
        if (!url) return url;
        return url.endsWith('/') ? url : `${url}/`;
    }

    //#endregion Model management
    //#region File management
    function handleIncomingFiles(files, { alsoAttach }) {
        files.forEach(file => {
            const meta = buildFileMeta(file);
            const entry = { ...meta, file };
            fileState.set(meta.name, entry);
            const card = createFileCard(entry);
            fileList?.prepend(card);
            if (alsoAttach) {
                attachFileToChat(meta.name);
            }
        });
    }

    function buildFileMeta(file) {
        const size = formatBytes(file.size);
        const pages = file.type === 'application/pdf' ? estimatePages(file.size) : 1;
        return { name: file.name || 'Unnamed.pdf', size, pages };
    }

    function estimatePages(bytes) {
        const approx = Math.max(1, Math.round(bytes / 80_000));
        return Math.min(approx, 120);
    }

    function attachFileInteractions(card, meta) {
        const { name } = meta;
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', name);
        });
        card.querySelector('.insert-btn')?.addEventListener('click', () => attachFileToChat(name));
    }

    function createFileCard(meta) {
        const card = document.createElement('article');
        card.className = 'file-card';
        card.draggable = true;
        card.dataset.name = meta.name;
        card.dataset.pages = String(meta.pages);
        card.dataset.size = meta.size;
        card.innerHTML = `
            <div class="file-pill">PDF</div>
            <div class="file-body">
                <p class="file-name">${meta.name}</p>
                <p class="file-meta">${meta.pages} page${meta.pages === 1 ? '' : 's'} · ${meta.size}</p>
            </div>
            <button class="chip subtle insert-btn" type="button">Insert</button>
        `;
        attachFileInteractions(card, meta);
        return card;
    }

    function attachFileToChat(name) {
        const meta = fileState.get(name) || { name, pages: 1 };
        addMessage({ role: 'system', text: `Attached "${meta.name}" (${meta.pages} page${meta.pages === 1 ? '' : 's'}).` });
    }
    //#endregion File management
    //#region Text extraction
    async function fileToText(file) {
        if (!file) throw new Error('Missing file for extraction');
        if (file.type !== 'application/pdf') {
            return file.text();
        }

        if (!window.pdfjsLib?.getDocument) {
            throw new Error('pdf.js is not loaded');
        }

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        return fullText.trim();
    }

    function chunkText(text, chunkSize = 500, overlap = 100) {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            let end = start + chunkSize;
            if (end > text.length) {
                end = text.length;
            }
            chunks.push(text.substring(start, end));
            start = end - overlap;
        }
        return chunks;
    }

    async function ensureTransformers() {
        if (transformersModule) return transformersModule;
        transformersModule = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@3.0.0');
        return transformersModule;
    }

    async function ensureEmbedder() {
        if (embedder) return embedder;
        const { pipeline } = await ensureTransformers();
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
        return embedder;
    }

    async function embedText(text) {
        const model = await ensureEmbedder();
        const output = await model(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }

    async function embedFile(file) {
        const text = await fileToText(file);
        const chunks = chunkText(text);
        const chunkIds = chunks.map((_, i) => `${file.name || 'file'}_${i + 1}`);
        const embeddings = await Promise.all(chunks.map(embedText));
        const entries = chunks.map((chunk, i) => ({
            id: chunkIds[i],
            text: chunk,
            embedding: embeddings[i],
        }));
        vectorStore.push(...entries);
        return { fileName: file.name || 'file', chunkCount: chunks.length };
    }
    //#endregion Text extraction
    //#region Search engine
    function cosineSimilarity(a, b) {
        let dot = 0, aMag = 0, bMag = 0;
        for (let i = 0; i < a.length; i++) {
            const ai = a[i], bi = b[i];
            dot += ai * bi;
            aMag += ai * ai;
            bMag += bi * bi;
        }
        const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
        return denom ? dot / denom : 0;
    }

    function topKRelevant(queryVec, k = 5) {
        return vectorStore
            .map(entry => ({ ...entry, score: cosineSimilarity(queryVec, entry.embedding) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
    }

    function queryToChunks(query, k = 5) {
        return embedText(query).then(queryVec => topKRelevant(queryVec, k));
    }

    //#endregion Search engine
    //#region Helpers

    function mapChatToLLM(entry) {
        return { role: entry.role, content: entry.content };
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }
    //#endregion Helpers
});
