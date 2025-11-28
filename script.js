document.addEventListener('DOMContentLoaded', () => {

    //HTML elements
    const root = document.documentElement;
    const workspacePanel = document.getElementById('workspacePanel');
    const controlPanel = document.getElementById('controlPanel');
    const leftToggle = document.getElementById('leftToggle');
    const rightToggle = document.getElementById('rightToggle');
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
    const modelRadios = document.querySelectorAll('input[name="model"]');
    const historyList = document.getElementById('historyList');
    const tempSlider = document.getElementById('tempSlider');

    //Dynamic elements variables
    const sizes = { left: 320, right: 320, collapsed: 64 };
    const fileState = new Map();

    //The Memory
    const AllMessages = [
        { role: 'assistant', text: "Let's do this"},
    ];

    AllMessages.forEach(addMessage);
    wireExistingFileCards();
    setupPanels();
    setupDropZone();
    setupChatDropTarget();
    setupComposer();
    setupModels();
    setupHistory();
    setupTemperature();
    syncLayout();

    function wireExistingFileCards() {
        document.querySelectorAll('.file-card').forEach(card => {
            const name = card.dataset.name || 'Untitled.pdf';
            const pages = Number(card.dataset.pages || '1');
            const size = card.dataset.size || '';
            fileState.set(name, { name, pages, size });
            attachFileInteractions(card, { name, pages, size });
        });
    }

    function setupPanels() {
        const toggle = (panel) => {
            const isCollapsed = panel.classList.toggle('collapsed');
            const trigger = panel === workspacePanel ? leftToggle : rightToggle;
            trigger?.setAttribute('aria-expanded', (!isCollapsed).toString());
            syncLayout();
        };

        leftToggle?.addEventListener('click', () => toggle(workspacePanel));
        rightToggle?.addEventListener('click', () => toggle(controlPanel));
    }

    function syncLayout() {
        const leftSize = workspacePanel?.classList.contains('collapsed') ? sizes.collapsed : sizes.left;
        const rightSize = controlPanel?.classList.contains('collapsed') ? sizes.collapsed : sizes.right;
        root.style.setProperty('--left-size', `${leftSize}px`);
        root.style.setProperty('--right-size', `${rightSize}px`);
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

    function setupComposer() {
        messageForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = messageInput?.value.trim();
            if (!text) return;
            addMessage({ role: 'user', text });
            messageInput.value = '';
            simulateAssistantResponse(text);
        });
    }

    function setupModels() {
        modelRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                activeModel.textContent = `Model: ${radio.value}`;
                addMessage({ role: 'system', text: `Switched to ${radio.value}.` });
            });
        });
    }

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

    function setupTemperature() {
        tempSlider?.addEventListener('input', () => {
            const value = Number(tempSlider.value) / 100;
            modelMeta.textContent = `temperature · ${value.toFixed(2)}`;
        });
    }

    function handleIncomingFiles(files, { alsoAttach }) {
        files.forEach(file => {
            const meta = buildFileMeta(file);
            fileState.set(meta.name, meta);
            const card = createFileCard(meta);
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

    function addMessage({ role, text }) {
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
    }

    function simulateAssistantResponse(prompt) {
        const model = activeModel.textContent.replace('Model: ', '') || 'SOTA-Alpha';
        setTimeout(() => {
            addMessage({
                role: 'assistant',
                text: `Nothing is implemented, what did you expect ?`
            });
        }, 550);
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }

    function estimatePages(bytes) {
        const approx = Math.max(1, Math.round(bytes / 80_000));
        return Math.min(approx, 120);
    }
});
