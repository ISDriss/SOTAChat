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
    const interruptButton = document.getElementById('interruptButton');
    const sendButton = document.getElementById('sendButton');
    const activeModel = document.getElementById('activeModel');
    const modelMeta = document.getElementById('modelMeta');
    const modelSelect = document.getElementById('modelSelect');
    const modelStatus = document.getElementById('modelStatus');
    const tempSlider = document.getElementById('tempSlider');
    const systemPromptTextArea = document.getElementById('systemPromptTextArea');
    const resetSystemPrompt = document.getElementById('resetSystemPrompt');

    // vars
    const sizes = { left: 300, right: 340, collapsed: 64 };
    const fileState = new Map();
    const chatLog = [];
    const BASE_SYSTEM_PROMPT = 
`You are SOTACHAT, a literature review assistant.
You are given a chat history and a CONTEXT BLOCK containing excerpts from user loaded papers.

Hard rules:
- Use the CONTEXT BLOCK for factual claims.
- If the CONTEXT BLOCK is empty, reply: "No PDF context available. Please attach PDFs." or "Hello! How can I assist you today?"
- Do NOT invent papers, titles, authors, numbers, or citations.
- Citations must be exactly one of the chunk ids shown in the CONTEXT BLOCK, like [myfile_3].
- Prefer synthesis over listing: compare papers, highlight agreements/disagreements.
- Be concise, prefer short answers, avoid repetition and stay on topic.`;
    let systemPrompt = BASE_SYSTEM_PROMPT;
    let MAX_CHAT_MESSAGES = 10;
    let vectorStore = [];
    let appConfig = null;
    let temperature = 0.3;
    let max_tokens = 500;
    let webllmModule = null;
    let transformersModule = null;
    let embedder = null;
    let enginePromise = null;
    let currentModel = null;
    let currentGeneration = null;

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

    //#region Setup
    renderModelSelect();
    wireExistingFileCards();
    setupPanels();
    setupDropZone();
    setupChatDropTarget();
    setupComposer();
    setupTemperature();
    setupSystemPrompt();
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

    // Temperature
    function setupTemperature() {
        const updateTemp = () => {
            const raw = Number(tempSlider?.value ?? 30);
            temperature = Number.isFinite(raw) ? raw / 100 : 0.3;
            modelMeta.textContent = `temperature · ${temperature.toFixed(2)}`;
        };
        tempSlider?.addEventListener('input', updateTemp);
        updateTemp(); // set initial display/state
    }
    
    // System prompt
    function setupSystemPrompt() {
        systemPromptTextArea.value = systemPrompt;
        const updatePrompt = () => {
            const text = systemPromptTextArea?.value.trim() || '';
            systemPrompt = text;
        };
        systemPromptTextArea?.addEventListener('input', updatePrompt);
        resetSystemPrompt?.addEventListener('click', () => {
            systemPrompt = BASE_SYSTEM_PROMPT;
            systemPromptTextArea.value = systemPrompt;
        });
    }

    //#endregion Setup
    //#region Chat
    function setupComposer() {
        messageForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = messageInput?.value.trim();
            if (!text) return;
            if (currentGeneration) {
                console.warn('Generation already in progress, ignoring new submit.');
                return;
            }
            addMessage({ role: 'user', text });
            messageInput.value = '';
            await respondToUser(text);
        });

        interruptButton?.addEventListener('click', () => {
            if (!currentGeneration) return;
            currentGeneration.cancelRequested = true;
            currentGeneration.abortController?.abort();
            interruptButton.disabled = true;
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

    function mapChatToLLM(entry) {
        return { role: entry.role, content: entry.content };
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
                const abortController = new AbortController();
                currentGeneration = { cancelRequested: false, abortController };
                setGeneratingState(true);
                placeholder.content.textContent = `Running ${currentModel?.label}…`;
                const contextChunks = await queryToChunks(prompt, 5); // top 5 relevant chunks
                const contextText = contextChunks.map(c => `[${c.id}] ${c.text}`).join("\n\n");
                const contextMsg = { 
                    role: "system", 
                    content: systemPrompt
                    + `\n\nCONTEXT BLOCK:\n\n${contextText ? contextText : '(empty)'}\n\n`
                };
                const recent = chatLog.slice(-MAX_CHAT_MESSAGES).map(mapChatToLLM);
                const messages = [
                    contextMsg,
                    ...recent
                ];
                console.log('llm message payload:', messages);
                const requestPayload = {
                    model: currentModel?.modelId,
                    messages: messages,
                    temperature: temperature,
                    max_tokens: max_tokens,
                    stream: true,
                    signal: abortController.signal
                };

                let completion = null;
                try {
                    completion = await engine.chat.completions.create(requestPayload);
                } catch (streamErr) {
                    console.warn('Streaming request failed, retrying without stream', streamErr);
                    completion = await engine.chat.completions.create({ ...requestPayload, stream: false });
                    completion = await engine.chat.completions.create({ ...requestPayload, stream: false });
                }

                const isStream = completion && typeof completion[Symbol.asyncIterator] === 'function';
                if (isStream) {
                    placeholder.content.textContent = '';
                    let fullText = '';
                    for await (const chunk of completion) {
                        if (currentGeneration?.cancelRequested) {
                            if (typeof completion.return === 'function') {
                                try { await completion.return(); } catch (err) { console.warn('Stream return failed', err); }
                            }
                            placeholder.content.textContent = fullText || '(stopped)';
                            addMessage({ role: 'system', text: 'Generation interrupted.' });
                            return;
                        }
                        const delta = extractContentDelta(chunk);
                        if (!delta) continue;
                        fullText += delta;
                        placeholder.content.textContent = fullText;
                        chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
                    }
                    const finalText = fullText || 'No response generated.';
                    placeholder.content.textContent = finalText;
                    chatLog.push({ role: 'assistant', content: finalText });
                    return;
                }

                const reply = completion?.choices?.[0]?.message?.content || 'No response generated.';
                placeholder.content.textContent = reply;
                chatLog.push({ role: 'assistant', content: reply });
                return;
            } catch (err) {
                if (currentGeneration?.cancelRequested) {
                    placeholder.content.textContent = 'Generation interrupted.';
                    addMessage({ role: 'system', text: 'Generation interrupted.' });
                } else {
                    console.error('Model inference error', err);
                    placeholder.content.textContent = `Model error: ${err?.message || err}`;
                }
                return;
            } finally {
                currentGeneration = null;
                setGeneratingState(false);
            }
        }
        const fallback = `(offline) I will summarize based on your PDFs and prompt: "${prompt}".`;
        placeholder.content.textContent = fallback;
        chatLog.push({ role: 'assistant', content: fallback });
    }

    //#endregion Chat
    //#region Model management
    function renderModelSelect() {
        if (!modelSelect) return;
        modelSelect.innerHTML = '';
        MODEL_CATALOG.forEach((meta) => {
            const option = document.createElement('option');
            option.value = meta.modelId;
            option.textContent = `${meta.label} — ${meta.blurb}`;
            modelSelect.appendChild(option);
        });
        modelSelect.addEventListener('change', () => {
            const meta = MODEL_CATALOG.find(m => m.modelId === modelSelect.value);
            if (meta) selectModel(meta);
        });
        if (MODEL_CATALOG[0]) {
            modelSelect.value = MODEL_CATALOG[0].modelId;
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

    function attachFileInteractions(card, meta) {
        const { name } = meta;

        card.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData("text/plain", name);
        });

        card.querySelector(".insert-btn")?.addEventListener("click", async () => {
            await attachDetachSwitch(card, name);
        });
    }

    async function attachDetachSwitch(card, name) {
        const btn = card.querySelector(".insert-btn");
        if (!btn) return;

        const isAttached = btn.dataset.attached === "true";

        btn.disabled = true;

        try {
            if (!isAttached) {
            await attachFileToChat(name);
            btn.textContent = "Remove";
            btn.dataset.attached = "true";
            } else {
            await detachFileFromChat(name);
            btn.textContent = "Insert";
            btn.dataset.attached = "false";
            }
        } catch (err) {
            console.error("Attach/detach failed:", err);
            // optionally show a system message in UI
        } finally {
            btn.disabled = false;
        }
    }


    async function attachFileToChat(name) {
        const meta = fileState.get(name) || { name, pages: 1 };
        const placeholder = addMessage({ role: 'system', text: `Adding "${meta.name}"…` });
        if (!meta.file) {
            placeholder.content.textContent = `No file data for "${meta.name}". Please re-upload.`;
            return;
        }
        try {
            const result = await embedFile(meta.file);
            placeholder.content.textContent = `Attached "${meta.name}" (${meta.pages} page${meta.pages === 1 ? '' : 's'}) with ${result.chunkCount} chunk${result.chunkCount === 1 ? '' : 's'}.`;
        } catch (err) {
            console.error('Embed file error:', err);
            placeholder.content.textContent = `Failed to add "${meta.name}": ${err?.message || err}`;
        }
        console.log('Current vector store size:', vectorStore.length);
        console.log('file attached:', name);
    }

    async function detachFileFromChat(name) {
        const initialCount = vectorStore.length;
        vectorStore = vectorStore.filter(entry => !entry.source || entry.source !== name);
        const removedCount = initialCount - vectorStore.length;
        addMessage({ role: 'system', text: `Detached "${name}", removed ${removedCount} chunk${removedCount === 1 ? '' : 's'}.` });
        console.log('file detached:', name);
        console.log('Current vector store size:', vectorStore.length);
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
        if (chunkSize <= 0) throw new Error('chunkSize must be positive');
        const step = Math.max(1, chunkSize - overlap);

        const chunks = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            chunks.push(text.substring(start, end));
            if (end === text.length) break;
            start += step;
        }
        return chunks;
    }

    async function ensureTransformers() {
        if (transformersModule) return transformersModule;
        const candidates = [
            'https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js',
            'https://cdn.jsdelivr.net/npm/@xenova/transformers@3.1.0/dist/transformers.min.js',
            'https://cdn.jsdelivr.net/npm/@xenova/transformers@3.0.0/dist/transformers.min.js',
            'https://unpkg.com/@xenova/transformers/dist/transformers.min.js'
        ];
        let lastErr = null;
        for (const url of candidates) {
            try {
                transformersModule = await import(`${url}?module`);
                return transformersModule;
            } catch (err) {
                lastErr = err;
                console.warn('Transformer import failed for', url, err);
            }
        }
        throw lastErr || new Error('Failed to load @xenova/transformers');
    }

    async function ensureEmbedder() {
        if (embedder) return embedder;
        const { pipeline, env } = await ensureTransformers();
        env.allowLocalModels = false; // skip /models/ lookups
        env.remoteModels = true;
        env.remoteHost = 'https://huggingface.co';
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

        const entries = [];
        const batchSize = 8; // tune: 4-16 depending on device

        for (let i = 0; i < chunks.length; i += batchSize) {
            const batchChunks = chunks.slice(i, i + batchSize);
            const batchEmbeddings = await Promise.all(batchChunks.map(embedText));

            for (let j = 0; j < batchChunks.length; j++) {
            entries.push({
                id: chunkIds[i + j],
                text: batchChunks[j],
                embedding: batchEmbeddings[j],
                source: file.name || "file"
            });
            }

            // Keep UI alive + allow clicks/scroll
            await yieldToUI();
        }

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

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }

    function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
    }

    // Yield to UI every so often so the page stays responsive
    async function yieldToUI() {
        await new Promise(requestAnimationFrame);
    }

    function extractContentDelta(chunk) {
        if (!chunk?.choices?.length) return '';
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
        if (Array.isArray(delta)) {
            return delta.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
        }
        return typeof delta === 'string' ? delta : '';
    }

    function setGeneratingState(active) {
        if (sendButton) sendButton.disabled = !!active;
        if (interruptButton) interruptButton.disabled = !active;
        if (!active) {
            currentGeneration = null;
        }
    }

    //#endregion Helpers
});
