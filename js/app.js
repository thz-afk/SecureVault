'use strict';

class App {
    constructor() {
        this.store = new VaultStore();
        this.currentBlock = 'default';
        this.pendingAction = null;
        this.editingNoteId = null;
        this.sessionTimerInterval = null;

        this.init();
    }

    init() {
        this.attachEventListeners();

        if (this.store.exists()) {
            if (this.store.hasValidSession()) {
                this.showLoginWithSession();
            } else {
                this.showLogin();
            }
        } else {
            this.showRegister();
        }
    }

    showLoginWithSession() {
        const msg = document.getElementById('authMsg');
        if (msg) {
            msg.textContent = 'Sessão ainda ativa. Digite sua senha para continuar.';
        }
        this.showLogin();
    }

    attachEventListeners() {
        // Auth form
        this.attachFormListener('authForm', (e) => this.handleAuth(e));
        this.attachFormListener('reauthForm', (e) => this.handleReAuth(e));

        // Menu items
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.switchSection(e));
        });

        // Standard buttons
        this.attachButtonListener('logoutBtn', () => this.logout());
        this.attachButtonListener('configBtn', () => this.openModal('configModal'));
        this.attachButtonListener('extendSessionBtn', () => this.extendSession());
        this.attachButtonListener('addBlkBtn', () => this.checkAuthAndDo(() => this.openModal('blkModal')));
        this.attachButtonListener('addPwdBtn', () => this.checkAuthAndDo(() => this.openPasswordModal()));
        this.attachButtonListener('addNoteBtn', () => this.checkAuthAndDo(() => this.openNoteModal()));
        this.attachButtonListener('genPwdBtn', () => this.generatePassword());
        this.attachButtonListener('copyGenBtn', () => this.copyGenerated());
        this.attachButtonListener('genQuickPwdBtn', () => this.generateQuickPassword());
        this.attachButtonListener('genPersonBtn', () => this.generatePerson());
        this.attachButtonListener('showSavedPersonsBtn', () => this.showSavedPersons());
        this.attachButtonListener('saveConfigBtn', () => this.saveConfig());

        // Database operations
        this.attachButtonListener('openDbModalBtn', () => this.checkAuthAndDo(() => this.openModal('dbModal')));
        this.attachButtonListener('btnExportAction', () => this.handleExport());
        this.attachButtonListener('btnImportAction', () => this.handleImport());

        this.startSessionTimer();

        // Modal close
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.dataset.modal;
                if (modal) this.closeModal(modal);
            });
        });

        // Forms
        this.attachFormListener('blkForm', (e) => this.saveBlock(e));
        this.attachFormListener('pwdForm', (e) => this.savePassword(e));
        this.attachFormListener('noteForm', (e) => this.saveNote(e));
    }

    attachButtonListener(id, handler) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handler);
    }

    attachFormListener(id, handler) {
        const form = document.getElementById(id);
        if (form) form.addEventListener('submit', handler);
    }

    // Import/Export Logic

    async handleExport() {
        if (!this.store.isAuthenticated()) {
            this.showToast('Faça login para exportar', 'error');
            return;
        }

        const format = document.getElementById('exportFormat').value;
        const password = document.getElementById('exportFilePwd').value;
        const btn = document.getElementById('btnExportAction');

        if ((format === 'kdbx' || format === 'json_enc') && !password) {
            this.showToast('Defina uma senha para proteger o arquivo', 'error');
            document.getElementById('exportFilePwd').focus();
            return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Gerando arquivo...';

        try {
            let data, filename, mime;
            const dateStr = new Date().toISOString().slice(0, 10);

            if (format === 'csv') {
                data = this.generateCSV();
                filename = `SecureVault_Backup_${dateStr}.csv`;
                mime = 'text/csv';
            } else if (format === 'json') {
                data = JSON.stringify(this.store.vault, null, 2);
                filename = `SecureVault_Backup_${dateStr}.json`;
                mime = 'application/json';
            } else if (format === 'json_enc') {
                const jsonStr = JSON.stringify(this.store.vault);
                data = await this.encryptDataAES(jsonStr, password);
                filename = `SecureVault_Encrypted_${dateStr}.json`;
                mime = 'application/json';
            } else if (format === 'kdbx') {
                if (!window.kdbxweb) throw new Error('Biblioteca kdbxweb não carregada.');
                data = await this.generateKDBX(password);
                filename = `SecureVault_${dateStr}.kdbx`;
                mime = 'application/octet-stream';
            }

            this.downloadFile(data, filename, mime);
            this.showToast('Backup gerado com sucesso!');
            this.closeModal('dbModal');
            document.getElementById('exportFilePwd').value = '';
        } catch (err) {
            console.error(err);
            this.showToast('Erro ao exportar: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async handleImport() {
        const fileInput = document.getElementById('importFile');
        const file = fileInput.files[0];
        const mode = document.getElementById('importMode').value;
        const password = document.getElementById('importFilePwd').value;
        const btn = document.getElementById('btnImportAction');

        if (!file) {
            this.showToast('Selecione um arquivo primeiro', 'error');
            return;
        }

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Processando...';

        try {
            let importedVault = { pwds: [], notes: [], blks: [] };
            let rawText;

            if (file.name.toLowerCase().endsWith('.csv')) {
                rawText = await file.text();
                importedVault = this.parseCSV(rawText);
            } else if (file.name.toLowerCase().endsWith('.json')) {
                rawText = await file.text();
                let json;
                try {
                    json = JSON.parse(rawText);
                } catch (e) {
                    throw new Error('Arquivo JSON inválido');
                }

                if (json.salt && json.iv && json.data) {
                    if (!password) {
                        document.getElementById('importPwdGroup').style.display = 'block';
                        throw new Error('Senha necessária para descriptografar');
                    }
                    const decryptedStr = await this.decryptDataAES(json, password);
                    importedVault = JSON.parse(decryptedStr);
                } else {
                    importedVault = json;
                }
            } else if (file.name.toLowerCase().endsWith('.kdbx')) {
                if (!window.kdbxweb) throw new Error('Biblioteca kdbxweb necessária');
                if (!password) {
                    document.getElementById('importPwdGroup').style.display = 'block';
                    throw new Error('Senha necessária para arquivo .kdbx');
                }
                const arrayBuffer = await file.arrayBuffer();
                importedVault = await this.parseKDBX(arrayBuffer, password);
            } else {
                throw new Error('Formato não suportado. Use .kdbx, .csv ou .json');
            }

            if (!importedVault || (!importedVault.pwds && !importedVault.entries && !importedVault.blks)) {
                throw new Error('Nenhum dado válido encontrado.');
            }

            if (mode === 'replace') {
                if (!confirm('ATENÇÃO: Isso apagará TODOS os dados atuais. Continuar?')) return;
                this.store.vault = importedVault;
                if (!this.store.vault.blks) this.store.vault.blks = [{ id: 'default', name: 'Geral' }];
                if (!this.store.vault.pwds) this.store.vault.pwds = [];
                if (!this.store.vault.notes) this.store.vault.notes = [];
            } else {
                let count = 0;
                if (importedVault.pwds && Array.isArray(importedVault.pwds)) {
                    importedVault.pwds.forEach(p => {
                        p.id = 'imp_' + Date.now() + Math.random().toString(36).substr(2, 5);
                        const blkExists = this.store.vault.blks.find(b => b.id === p.blk);
                        if (!blkExists) p.blk = 'default';
                        this.store.vault.pwds.push(p);
                        count++;
                    });
                }
                if (importedVault.notes && Array.isArray(importedVault.notes)) {
                    importedVault.notes.forEach(n => {
                        n.id = 'imp_n_' + Date.now() + Math.random().toString(36).substr(2, 5);
                        const blkExists = this.store.vault.blks.find(b => b.id === n.blk);
                        if (!blkExists) n.blk = 'default';
                        this.store.vault.notes.push(n);
                    });
                }
                this.showToast(`${count} itens importados.`);
            }

            await this.store.saveVault();
            this.loadBlocks();
            this.loadPasswords();
            this.loadNotes();
            this.closeModal('dbModal');

            fileInput.value = '';
            document.getElementById('importFilePwd').value = '';
            document.getElementById('importPwdGroup').style.display = 'none';

        } catch (err) {
            console.error(err);
            let msg = err.message;
            if (err.code === 'InvalidKey') msg = 'Senha incorreta do arquivo KDBX.';
            if (msg.includes('argon2')) msg = 'Este arquivo usa Argon2 (não suportado). Exporte como AES.';
            this.showToast('Erro: ' + msg, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    // Helpers

    generateCSV() {
        const header = ['Bloco', 'Site', 'Usuario', 'Senha', 'Notas'];
        const rows = this.store.vault.pwds.map(p => {
            const blkName = this.store.vault.blks.find(b => b.id === p.blk)?.name || 'Geral';
            const esc = (t) => `"${String(t || '').replace(/"/g, '""')}"`;
            return [
                esc(blkName),
                esc(p.site),
                esc(p.usr),
                esc(p.val),
                esc('')
            ].join(',');
        });
        return [header.join(','), ...rows].join('\n');
    }


    async generateKDBX(password) {
        const safeFilePassword = String(password || '');
        const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(safeFilePassword));

        // Create database
        const db = kdbxweb.Kdbx.create(credentials, 'SecureVault Export');

        // Set AES for compatibility
        // If setKdf doesn't exist (very old versions), default is used (usually AES or ChaCha20)
        if (typeof db.setKdf === 'function') {
            try {
                db.setKdf(kdbxweb.Consts.KdfId.Aes);
            } catch (e) {
                console.warn("KDBX: Não foi possível definir KDF AES explicitamente. Usando padrão.", e);
            }
        }

        const defaultGroup = db.getDefaultGroup();
        defaultGroup.name = 'SecureVault';

        const groupMap = {};

        // Create group structure
        this.store.vault.blks.forEach(blk => {
            const blkName = String(blk.name || 'Sem Nome');
            if (blk.id === 'default') {
                groupMap['default'] = defaultGroup;
            } else {
                const grp = db.createGroup(defaultGroup, blkName);
                groupMap[blk.id] = grp;
            }
        });

        // Add passwords
        this.store.vault.pwds.forEach(p => {
            const targetGroup = groupMap[p.blk] || defaultGroup;
            const entry = db.createEntry(targetGroup);

            // Strict sanitization to avoid InvalidArg
            const safeTitle = String(p.site || 'Sem Título');
            const safeUser = String(p.usr || '');
            const safePass = String(p.val || '');
            const safeUrl = String(p.site || '');

            entry.fields.set('Title', safeTitle);
            entry.fields.set('UserName', safeUser);
            entry.fields.set('URL', safeUrl);

            // ProtectedValue must receive a non-null string
            try {
                const protectedPass = kdbxweb.ProtectedValue.fromString(safePass);
                entry.fields.set('Password', protectedPass);
            } catch (e) {
                // Fallback if ProtectedValue fails, saves as plain text if necessary
                console.warn("Erro ao proteger senha, salvando como texto", e);
                entry.fields.set('Password', safePass);
            }

            entry.times.creationTime = new Date();
            entry.times.lastModificationTime = new Date();
        });

        return await db.save();
    }

    parseCSV(text) {
        const lines = text.split(/\r?\n/);
        const vault = { blks: [], pwds: [], notes: [] };
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const matches = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
            const cols = matches.map(m => m.replace(/^"|"$/g, '').replace(/""/g, '"'));

            if (cols.length >= 3) {
                vault.pwds.push({
                    blk: 'default',
                    site: cols[1] || 'Sem Nome',
                    usr: cols[2] || '',
                    val: cols[3] || ''
                });
            }
        }
        return vault;
    }

    async parseKDBX(arrayBuffer, password) {
        const safePassword = String(password || '');
        const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(safePassword));
        const db = await kdbxweb.Kdbx.load(arrayBuffer, credentials);
        const vault = { blks: [], pwds: [], notes: [] };

        const traverse = (group) => {
            group.entries.forEach(entry => {
                const title = entry.fields.get('Title') || 'Sem Titulo';
                const user = entry.fields.get('UserName') || '';

                const passField = entry.fields.get('Password');
                let passVal = '';

                if (passField) {
                    if (passField instanceof kdbxweb.ProtectedValue) {
                         passVal = passField.getText();
                    } else if (typeof passField.getText === 'function') {
                        passVal = passField.getText();
                    } else {
                        passVal = String(passField);
                    }
                }

                if (passVal) {
                    vault.pwds.push({
                        blk: 'default',
                        site: title,
                        usr: user,
                        val: passVal
                    });
                }
            });
            group.groups.forEach(g => traverse(g));
        };

        if (db.getDefaultGroup()) {
            traverse(db.getDefaultGroup());
        }

        return vault;
    }

    async encryptDataAES(dataStr, pwd) {
        const enc = new TextEncoder();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"]);
        const key = await window.crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
        const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(dataStr));
        const toB64 = (u8) => btoa(String.fromCharCode(...u8));
        return JSON.stringify({ salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(encrypted)) });
    }

    async decryptDataAES(jsonObj, pwd) {
        const fromB64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));
        const salt = fromB64(jsonObj.salt);
        const iv = fromB64(jsonObj.iv);
        const data = fromB64(jsonObj.data);
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"]);
        const key = await window.crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return new TextDecoder().decode(decrypted);
    }

    downloadFile(content, filename, mime) {
        const blob = (content instanceof Blob) ? content : new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    // --- UI LOGIC ---

    showLogin() {
        const authMsg = document.getElementById('authMsg');
        const authBtnTxt = document.getElementById('authBtnTxt');
        const confirmGroup = document.getElementById('confirmGroup');
        if (authMsg) authMsg.textContent = 'Digite sua senha mestre para acessar';
        if (authBtnTxt) authBtnTxt.textContent = 'Entrar';
        if (confirmGroup) confirmGroup.style.display = 'none';
    }

    showRegister() {
        const authMsg = document.getElementById('authMsg');
        const authBtnTxt = document.getElementById('authBtnTxt');
        const confirmGroup = document.getElementById('confirmGroup');
        if (authMsg) authMsg.textContent = 'Crie uma senha mestre para proteger seus dados';
        if (authBtnTxt) authBtnTxt.textContent = 'Criar Senha';
        if (confirmGroup) confirmGroup.style.display = 'block';
    }

    async handleAuth(e) {
        e.preventDefault();
        if (!Security.checkRate('auth')) {
            this.showToast('Muitas tentativas. Aguarde 1 minuto.', 'error');
            return;
        }
        const pwdInput = document.getElementById('masterPwd');
        const confInput = document.getElementById('confirmPwd');
        const btn = document.getElementById('authBtn');
        const password = pwdInput.value;
        const confirm = confInput ? confInput.value : '';

        if (!Security.validate(password, 128)) {
            this.showToast('Senha contém caracteres inválidos', 'error');
            return;
        }
        btn.disabled = true;

        try {
            const extSession = document.getElementById('extendSession');
            let sessDuration = extSession && extSession.checked ? 1800000 : 60000;
            if (this.store.hasValidSession()) {
                const rem = this.store.getSessionTimeRemaining();
                if (rem > 0) sessDuration = rem + (extSession && extSession.checked ? 1800000 : 60000);
            }

            if (this.store.exists()) {
                const success = await this.store.openVault(password, sessDuration);
                if (success) this.enterDashboard();
                else this.showToast('Senha incorreta', 'error');
            } else {
                if (password !== confirm) {
                    this.showToast('Senhas não coincidem', 'error');
                    return;
                }
                await this.store.createVault(password, sessDuration);
                this.enterDashboard();
            }
        } finally {
            pwdInput.value = '';
            if (confInput) confInput.value = '';
            btn.disabled = false;
        }
    }

    async handleReAuth(e) {
        e.preventDefault();
        if (!Security.checkRate('reauth')) {
            this.showToast('Muitas tentativas. Aguarde.', 'error');
            return;
        }
        const pwdInput = document.getElementById('authPwd');
        const password = pwdInput.value;

        if (!Security.validate(password, 128)) {
            this.showToast('Senha inválida', 'error');
            return;
        }

        const success = await this.store.reAuthenticate(password);
        if (success) {
            this.closeModal('authModal');
            if (this.pendingAction) {
                this.pendingAction();
                this.pendingAction = null;
            }
            this.showToast('Autenticado', 'success');
        } else {
            this.showToast('Senha incorreta', 'error');
        }
        pwdInput.value = '';
    }

    enterDashboard() {
        if (!this.store.isAuthenticated()) {
            this.showToast('Autenticação necessária', 'error');
            return;
        }
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        this.startSessionTimer();
        this.showToast('Bem-vindo!', 'success');
    }

    startSessionTimer() {
        if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
        this.updateSessionTimer();
        this.sessionTimerInterval = setInterval(() => this.updateSessionTimer(), 1000);
    }

    updateSessionTimer() {
        const timerDisp = document.getElementById('timerDisplay');
        const extendBtn = document.getElementById('extendSessionBtn');
        if (!timerDisp || !extendBtn) return;

        if (!this.store.isAuthenticated()) {
            timerDisp.textContent = 'Expirada';
            timerDisp.style.color = 'var(--danger)';
            extendBtn.disabled = true;
            return;
        }
        const rem = this.store.getSessionTimeRemaining();
        if (rem <= 0) {
            timerDisp.textContent = 'Expirada';
            timerDisp.style.color = 'var(--danger)';
            extendBtn.disabled = true;
            return;
        }
        const totalSec = Math.floor(rem / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        timerDisp.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        if (totalSec < 60) timerDisp.style.color = 'var(--danger)';
        else if (totalSec < 300) timerDisp.style.color = 'var(--warn)';
        else timerDisp.style.color = 'var(--txt-sec)';
        extendBtn.disabled = false;
    }

    extendSession() {
        if (!this.store.isAuthenticated()) return;
        if (this.store.extendSession(30)) {
            this.showToast('Sessão prolongada em 30 minutos', 'success');
            this.updateSessionTimer();
        }
    }

    checkAuthAndDo(action) {
        if (this.store.isAuthenticated()) action();
        else {
            this.pendingAction = action;
            this.openModal('authModal');
        }
    }

    logout() {
        if (confirm('Deseja sair?')) {
            if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
            this.store.lock();
            location.reload();
        }
    }

    switchSection(e) {
        const section = e.currentTarget.dataset.section;
        if (!section) return;
        const sensSections = ['passwords', 'notes'];
        if (sensSections.includes(section) && !this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.switchSection(e));
            return;
        }
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        e.currentTarget.classList.add('active');
        document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
        const targetSec = document.getElementById(section);
        if (targetSec) targetSec.classList.add('active');

        if (this.store.isAuthenticated()) {
            if (section === 'passwords') this.loadPasswords();
            else if (section === 'notes') this.loadNotes();
        }
    }

    loadBlocks() {
        if (!this.store.isAuthenticated()) {
            const c = document.getElementById('blkList');
            if (c) c.innerHTML = '';
            return;
        }
        const container = document.getElementById('blkList');
        if (!container || !this.store.vault) return;

        container.innerHTML = '';
        this.store.vault.blks.forEach(block => {
            const div = document.createElement('div');
            div.className = `blk-item ${block.id === this.currentBlock ? 'active' : ''}`;
            div.style.cursor = 'pointer';
            div.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                this.selectBlock(block.id);
            });

            const span = document.createElement('span');
            span.textContent = block.name;
            div.appendChild(span);

            if (block.id !== 'default') {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon';
                delBtn.style.padding = '4px';
                delBtn.textContent = '✕';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteBlock(block.id);
                });
                div.appendChild(delBtn);
            }
            container.appendChild(div);
        });
    }

    selectBlock(id) {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.selectBlock(id));
            return;
        }
        this.currentBlock = id;
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
    }

    async saveBlock(e) {
        e.preventDefault();
        if (!this.store.isAuthenticated()) return;
        const nameInput = document.getElementById('blkName');
        const name = nameInput.value;

        if (!Security.validate(name, 50)) {
            this.showToast('Nome inválido', 'error');
            return;
        }
        const id = 'blk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.store.vault.blks.push({ id, name });
        await this.store.saveVault();
        this.loadBlocks();
        this.closeModal('blkModal');
        this.showToast('Bloco criado');
        nameInput.value = '';
    }

    async deleteBlock(id) {
        if (!this.store.isAuthenticated()) return;
        if (id === 'default') return;
        if (!confirm('Excluir bloco e todo conteúdo?')) return;

        this.store.vault.blks = this.store.vault.blks.filter(b => b.id !== id);
        this.store.vault.pwds = this.store.vault.pwds.filter(p => p.blk !== id);
        this.store.vault.notes = this.store.vault.notes.filter(n => n.blk !== id);

        await this.store.saveVault();
        if (this.currentBlock === id) this.currentBlock = 'default';
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        this.showToast('Bloco excluído');
    }

    loadPasswords() {
        if (!this.store.isAuthenticated()) {
            const c = document.getElementById('pwdList');
            if (c) c.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            return;
        }
        const container = document.getElementById('pwdList');
        if (!container || !this.store.vault) return;

        const pwds = this.store.vault.pwds.filter(p => p.blk === this.currentBlock);
        if (pwds.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma senha salva</p>';
            return;
        }
        container.innerHTML = '';

        pwds.forEach(pwd => {
            const card = document.createElement('div');
            card.className = 'pwd-card';

            const header = document.createElement('div');
            header.className = 'pwd-header';

            const info = document.createElement('div');
            const site = document.createElement('div');
            site.className = 'pwd-site';
            site.textContent = pwd.site;
            const user = document.createElement('div');
            user.className = 'pwd-user';
            user.textContent = pwd.usr;
            info.appendChild(site);
            info.appendChild(user);

            const expandBtn = document.createElement('button');
            expandBtn.className = 'btn btn-expand';
            expandBtn.textContent = 'Ver Mais';
            header.appendChild(info);
            header.appendChild(expandBtn);

            const dtls = document.createElement('div');
            dtls.className = 'pwd-details';
            dtls.id = `pwd-${pwd.id}`;

            const field = document.createElement('div');
            field.className = 'pwd-field';
            const label = document.createElement('label');
            label.textContent = 'Senha';

            const wrap = document.createElement('div');
            wrap.className = 'pwd-value-wrapper';

            const value = document.createElement('div');
            value.className = 'pwd-value';
            value.id = `pwdval-${pwd.id}`;
            value.textContent = '••••••••';

            const showBtn = document.createElement('button');
            showBtn.className = 'btn-icon';
            showBtn.textContent = 'Ver';
            showBtn.addEventListener('click', () => this.togglePasswordVisibility(pwd.id));

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-icon';
            copyBtn.textContent = 'Copiar';
            copyBtn.addEventListener('click', () => this.copyPassword(pwd.id));

            wrap.appendChild(value);
            wrap.appendChild(showBtn);
            wrap.appendChild(copyBtn);
            field.appendChild(label);
            field.appendChild(wrap);

            const actions = document.createElement('div');
            actions.style.marginTop = '16px';
            actions.style.display = 'flex';
            actions.style.gap = '8px';

            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Excluir';
            delBtn.addEventListener('click', () => this.deletePassword(pwd.id));
            actions.appendChild(delBtn);

            dtls.appendChild(field);
            dtls.appendChild(actions);

            header.addEventListener('click', () => dtls.classList.toggle('show'));
            card.appendChild(header);
            card.appendChild(dtls);
            container.appendChild(card);
        });
    }

    openPasswordModal() {
        const select = document.getElementById('pwdBlk');
        if (!select) return;
        select.innerHTML = '';
        this.store.vault.blks.forEach(blk => {
            const option = document.createElement('option');
            option.value = blk.id;
            option.textContent = blk.name;
            if (blk.id === this.currentBlock) option.selected = true;
            select.appendChild(option);
        });
        this.openModal('pwdModal');
    }

    async savePassword(e) {
        e.preventDefault();
        if (!this.store.isAuthenticated()) return;

        const blk = document.getElementById('pwdBlk').value;
        const site = document.getElementById('pwdSite').value;
        const usr = document.getElementById('pwdUsr').value;
        const val = document.getElementById('pwdVal').value;

        if (!Security.validate(site, 100) || !Security.validate(usr, 200) || !Security.validate(val, 500)) {
            this.showToast('Dados inválidos', 'error');
            return;
        }
        const pwd = {
            id: 'pwd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            blk, site, usr, val
        };

        this.store.vault.pwds.push(pwd);
        await this.store.saveVault();
        this.loadPasswords();
        this.closeModal('pwdModal');
        this.showToast('Senha salva');
        e.target.reset();
    }

    togglePasswordVisibility(id) {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.togglePasswordVisibility(id));
            return;
        }
        const element = document.getElementById(`pwdval-${id}`);
        if (!element) return;
        const pwd = this.store.vault.pwds.find(p => p.id === id);
        if (!pwd) return;
        element.textContent = element.textContent === '••••••••' ? pwd.val : '••••••••';
    }

    copyPassword(id) {
        if (!this.store.isAuthenticated()) return;
        const pwd = this.store.vault.pwds.find(p => p.id === id);
        if (pwd) {
            navigator.clipboard.writeText(pwd.val)
                .then(() => this.showToast('Senha copiada'))
                .catch(() => this.showToast('Erro ao copiar', 'error'));
        }
    }

    async deletePassword(id) {
        if (!this.store.isAuthenticated()) return;
        if (!confirm('Excluir senha?')) return;
        this.store.vault.pwds = this.store.vault.pwds.filter(p => p.id !== id);
        await this.store.saveVault();
        this.loadPasswords();
        this.showToast('Senha excluída');
    }

    generatePassword() {
        const len = parseInt(document.getElementById('genLen').value) || 16;
        const upper = document.getElementById('genUpper').checked;
        const lower = document.getElementById('genLower').checked;
        const num = document.getElementById('genNum').checked;
        const sym = document.getElementById('genSym').checked;

        let charset = '';
        if (upper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (lower) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (num) charset += '0123456789';
        if (sym) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

        if (!charset) {
            this.showToast('Selecione pelo menos uma opção', 'error');
            return;
        }

        let password = '';
        const array = new Uint8Array(len);
        window.crypto.getRandomValues(array);
        for (let i = 0; i < len; i++) {
            password += charset[array[i] % charset.length];
        }

        const input = document.getElementById('genPwd');
        if (input) input.value = password;
    }

    copyGenerated() {
        const input = document.getElementById('genPwd');
        if (input && input.value) {
            navigator.clipboard.writeText(input.value).then(() => this.showToast('Copiado!'));
        }
    }

    generateQuickPassword() {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        const array = new Uint8Array(16);
        window.crypto.getRandomValues(array);
        for (let i = 0; i < 16; i++) {
            password += charset[array[i] % charset.length];
        }
        const input = document.getElementById('pwdVal');
        if (input) input.value = password;
    }

    generateName() {
        const names = ['Joao', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Julia', 'Lucas', 'Mariana', 'Rafael', 'Beatriz', 'Andre', 'Fernanda', 'Gabriel', 'Larissa', 'Bruno', 'Camila', 'Diego', 'Patricia', 'Rodrigo', 'Natalia', 'Felipe', 'Aline', 'Gustavo', 'Isabela', 'Thiago', 'Renata', 'Eduardo', 'Carolina'];
        const surnames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Costa', 'Ferreira', 'Gomes', 'Ribeiro', 'Almeida', 'Pereira', 'Rodrigues', 'Martins', 'Barbosa', 'Araujo', 'Cardoso', 'Melo', 'Correia', 'Teixeira', 'Dias', 'Nunes', 'Batista', 'Freitas', 'Vieira', 'Rocha'];
        return names[Math.floor(Math.random() * names.length)] + ' ' + surnames[Math.floor(Math.random() * surnames.length)];
    }

    generateBirthdate() {
        const year = 1950 + Math.floor(Math.random() * 50);
        const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
        const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
        return `${day}/${month}/${year}`;
    }

    generateAddress() {
        const street = (window.StreetsData && Array.isArray(window.StreetsData)) ? window.StreetsData[Math.floor(Math.random() * window.StreetsData.length)] : 'Rua Exemplo';
        return street + ', ' + Math.floor(Math.random() * 9999);
    }

    generateCPF() {
        const nums = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
        let d1 = 11 - (sum % 11);
        if (d1 >= 10) d1 = 0;
        nums.push(d1);

        sum = 0;
        for (let i = 0; i < 10; i++) sum += nums[i] * (11 - i);
        let d2 = 11 - (sum % 11);
        if (d2 >= 10) d2 = 0;
        nums.push(d2);

        return nums.slice(0, 3).join('') + '.' + nums.slice(3, 6).join('') + '.' + nums.slice(6, 9).join('') + '-' + nums.slice(9, 11).join('');
    }

    generatePerson() {
        const name = this.generateName();
        const cpf = this.generateCPF();
        const birthdate = this.generateBirthdate();
        const address = this.generateAddress();
        const emailUser = name.toLowerCase().replace(' ', '') + Math.floor(Math.random() * 9999);
        const service = this.store.config.emailSvc || 'tuamae';
        let email, link;

        if (service === 'tuamae') {
            email = emailUser + '@tuamaeaquelaursa.com';
            link = `https://tuamaeaquelaursa.com/${emailUser}`;
        } else {
            email = emailUser + '@firemail.com.br';
            link = `https://firemail.com.br/${emailUser}`;
        }

        this.currentPerson = { name, cpf, birthdate, email, link, address };
        this.displayPerson(this.currentPerson);
    }

    regenerateField(field) {
        if (!this.currentPerson) return;
        if (field === 'name') {
            this.generatePerson();
            return;
        }

        const generators = {
            cpf: this.generateCPF.bind(this),
            birthdate: this.generateBirthdate.bind(this),
            address: this.generateAddress.bind(this)
        };

        if (generators[field]) {
            this.currentPerson[field] = generators[field]();
            this.displayPerson(this.currentPerson);
        }
    }

    displayPerson(person) {
        const container = document.getElementById('personContent');
        if (!container) return;
        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'person-card';
        const fieldMap = { 'Nome': 'name', 'CPF': 'cpf', 'Nascimento': 'birthdate', 'Endereço': 'address' };

        const fields = [
            { label: 'Nome', value: person.name, id: 'personName', regenerate: true },
            { label: 'CPF', value: person.cpf, id: 'personCPF', regenerate: true },
            { label: 'Nascimento', value: person.birthdate, id: 'personBirthdate', regenerate: true },
            { label: 'Email', value: person.email, id: 'personEmail', hasActions: true, link: person.link },
            { label: 'Endereço', value: person.address, id: 'personAddress', regenerate: true }
        ];

        fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'person-field';

            const label = document.createElement('span');
            label.className = 'field-label';
            label.textContent = field.label + ':';

            const valDiv = document.createElement('div');
            valDiv.className = 'field-value';

            const textSpan = document.createElement('span');
            textSpan.id = field.id;
            textSpan.textContent = field.value;
            valDiv.appendChild(textSpan);

            if (field.hasActions) {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-icon';
                editBtn.textContent = '✏';
                editBtn.addEventListener('click', () => this.changeEmailDomain());
                valDiv.appendChild(editBtn);

                const linkBtn = document.createElement('button');
                linkBtn.className = 'btn-icon';
                linkBtn.textContent = '↗';
                linkBtn.addEventListener('click', () => {
                    const curr = document.getElementById('personEmail').textContent;
                    const u = curr.split('@')[0];
                    const d = curr.split('@')[1];
                    let l = field.link;
                    if (d === 'tuamaeaquelaursa.com') l = `https://tuamaeaquelaursa.com/${u}`;
                    else if (d === 'firemail.com.br') l = `https://firemail.com.br/${u}`;
                    window.open(l, '_blank');
                });
                valDiv.appendChild(linkBtn);
            }

            if (field.regenerate) {
                const regenBtn = document.createElement('button');
                regenBtn.className = 'btn-icon';
                regenBtn.textContent = '↻';
                regenBtn.addEventListener('click', () => this.regenerateField(fieldMap[field.label]));
                valDiv.appendChild(regenBtn);
            }

            div.appendChild(label);
            div.appendChild(valDiv);
            card.appendChild(div);
        });

        container.appendChild(card);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:12px;margin-top:16px;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = 'Salvar Preset';
        saveBtn.addEventListener('click', () => this.savePerson());

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = 'Copiar Dados';
        copyBtn.addEventListener('click', () => this.copyPerson(person));

        actions.appendChild(saveBtn);
        actions.appendChild(copyBtn);
        container.appendChild(actions);
    }

    changeEmailDomain() {
        const el = document.getElementById('personEmail');
        if (!el) return;
        const curr = el.textContent;
        const user = curr.split('@')[0];
        let newMail, newLink;

        if (curr.includes('@tuamaeaquelaursa')) {
            newMail = user + '@firemail.com.br';
            newLink = `https://firemail.com.br/${user}`;
        } else {
            newMail = user + '@tuamaeaquelaursa.com';
            newLink = `https://tuamaeaquelaursa.com/${user}`;
        }
        el.textContent = newMail;
        if (this.currentPerson) {
            this.currentPerson.email = newMail;
            this.currentPerson.link = newLink;
        }
    }

    async savePerson() {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.savePerson());
            return;
        }
        if (!this.currentPerson) return;

        this.currentPerson.id = 'prs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        if (!this.store.vault.prs) this.store.vault.prs = [];
        this.store.vault.prs.push(this.currentPerson);

        await this.store.saveVault();
        this.showToast('Pessoa salva');
    }

    copyPerson(p) {
        const txt = `Nome: ${p.name}\nCPF: ${p.cpf}\nNascimento: ${p.birthdate}\nEmail: ${p.email}\nEndereço: ${p.address}`;
        navigator.clipboard.writeText(txt).then(() => this.showToast('Dados copiados'));
    }

    showSavedPersons() {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.showSavedPersons());
            return;
        }
        const c = document.getElementById('personContent');
        if (!c) return;

        if (!this.store.vault.prs || this.store.vault.prs.length === 0) {
            c.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma pessoa salva</p>';
            return;
        }
        c.innerHTML = '';

        this.store.vault.prs.forEach(p => {
            const card = document.createElement('div');
            card.className = 'person-card';
            const fields = [{ l: 'Nome', v: p.name }, { l: 'CPF', v: p.cpf }, { l: 'Email', v: p.email }];

            fields.forEach(f => {
                const d = document.createElement('div');
                d.className = 'person-field';
                d.innerHTML = `<span class="field-label">${f.l}:</span><span class="field-value">${f.v}</span>`;
                card.appendChild(d);
            });

            const acts = document.createElement('div');
            acts.style.cssText = 'display:flex;gap:12px;margin-top:10px';

            const cBtn = document.createElement('button');
            cBtn.className = 'btn-icon';
            cBtn.textContent = '📋';
            cBtn.onclick = () => this.copyPerson(p);

            const dBtn = document.createElement('button');
            dBtn.className = 'btn-icon';
            dBtn.textContent = '🗑';
            dBtn.onclick = () => this.deletePerson(p.id);

            acts.appendChild(cBtn);
            acts.appendChild(dBtn);
            card.appendChild(acts);
            c.appendChild(card);
        });
    }

    async deletePerson(id) {
        if (!this.store.isAuthenticated()) return;
        if (!confirm('Excluir pessoa?')) return;
        this.store.vault.prs = this.store.vault.prs.filter(p => p.id !== id);
        await this.store.saveVault();
        this.showSavedPersons();
        this.showToast('Pessoa excluída');
    }

    loadNotes() {
        if (!this.store.isAuthenticated()) {
            const c = document.getElementById('notesList');
            if (c) c.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            return;
        }
        const container = document.getElementById('notesList');
        if (!container || !this.store.vault) return;

        const notes = this.store.vault.notes ? this.store.vault.notes.filter(n => n.blk === this.currentBlock) : [];
        if (notes.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma anotação salva</p>';
            return;
        }
        container.innerHTML = '';

        notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';

            const title = document.createElement('div');
            title.className = 'note-title';
            title.textContent = note.title;
            title.style.cursor = 'pointer';
            title.onclick = () => this.showNoteDetail(note);

            const acts = document.createElement('div');
            acts.style.cssText = 'display:flex;gap:8px';

            const edit = document.createElement('button');
            edit.className = 'btn-icon';
            edit.textContent = 'Editar';
            edit.onclick = (e) => {
                e.stopPropagation();
                this.openNoteModal(note);
            };

            const del = document.createElement('button');
            del.className = 'btn-icon';
            del.textContent = 'Apagar';
            del.onclick = (e) => {
                e.stopPropagation();
                this.deleteNote(note.id);
            };

            acts.appendChild(edit);
            acts.appendChild(del);
            header.appendChild(title);
            header.appendChild(acts);

            const preview = document.createElement('div');
            preview.className = 'note-preview';
            preview.textContent = note.content.substring(0, 100) + '...';
            preview.onclick = () => this.showNoteDetail(note);

            card.appendChild(header);
            card.appendChild(preview);
            container.appendChild(card);
        });
    }

    openNoteModal(note = null) {
        const select = document.getElementById('noteBlk');
        const tIn = document.getElementById('noteTitle');
        const cIn = document.getElementById('noteContent');
        const mTitle = document.querySelector('#noteModal .modal-title');
        if (!select || !tIn) return;

        this.editingNoteId = note ? note.id : null;
        if (mTitle) mTitle.textContent = note ? 'Editar Anotação' : 'Nova Anotação';

        if (note) {
            tIn.value = note.title;
            cIn.value = note.content;
        } else {
            tIn.value = '';
            cIn.value = '';
        }

        select.innerHTML = '';
        this.store.vault.blks.forEach(blk => {
            const opt = document.createElement('option');
            opt.value = blk.id;
            opt.textContent = blk.name;
            if ((note && blk.id === note.blk) || (!note && blk.id === this.currentBlock)) opt.selected = true;
            select.appendChild(opt);
        });
        this.openModal('noteModal');
    }

    async saveNote(e) {
        e.preventDefault();
        if (!this.store.isAuthenticated()) return;

        const blk = document.getElementById('noteBlk').value;
        const title = document.getElementById('noteTitle').value;
        const content = document.getElementById('noteContent').value;

        if (!Security.validate(title, 100) || !Security.validate(content, 5000)) {
            this.showToast('Dados inválidos', 'error');
            return;
        }
        if (!this.store.vault.notes) this.store.vault.notes = [];

        if (this.editingNoteId) {
            const idx = this.store.vault.notes.findIndex(n => n.id === this.editingNoteId);
            if (idx !== -1) {
                this.store.vault.notes[idx] = { id: this.editingNoteId, blk, title, content };
                await this.store.saveVault();
                this.loadNotes();
                this.closeModal('noteModal');
                this.showToast('Anotação atualizada');
                this.editingNoteId = null;
                e.target.reset();
                return;
            }
        }
        const note = {
            id: 'note_' + Date.now() + Math.random().toString(36).substr(2, 5),
            blk, title, content
        };
        this.store.vault.notes.push(note);
        await this.store.saveVault();
        this.loadNotes();
        this.closeModal('noteModal');
        this.showToast('Anotação salva');
        e.target.reset();
    }

    async deleteNote(id) {
        if (!this.store.isAuthenticated()) return;
        if (!confirm('Excluir anotação?')) return;
        this.store.vault.notes = this.store.vault.notes.filter(n => n.id !== id);
        await this.store.saveVault();
        this.loadNotes();
        this.showToast('Anotação excluída');
    }

    showNoteDetail(note) {
        alert(`${note.title}\n\n${note.content}`);
    }

    saveConfig() {
        const svc = document.querySelector('input[name="emailSvc"]:checked');
        if (!svc) return;
        this.store.config.emailSvc = svc.value;
        this.store.saveConfig();
        this.closeModal('configModal');
        this.showToast('Configurações salvas');
    }

    openModal(id) {
        const m = document.getElementById(id);
        if (m) {
            m.style.display = 'flex';
            setTimeout(() => m.classList.add('active'), 10);
        }
    }

    closeModal(id) {
        if (id === 'noteModal') {
            this.editingNoteId = null;
            const f = document.getElementById('noteForm');
            if (f) f.reset();
        }
        const m = document.getElementById(id);
        if (m) {
            m.classList.remove('active');
            setTimeout(() => m.style.display = 'none', 300);
        }
    }

    showToast(msg, type = 'success') {
        const t = document.getElementById('toast');
        const m = document.getElementById('toastMsg');
        if (!t || !m) return;
        m.textContent = msg;
        t.className = `toast show ${type}`;
        setTimeout(() => t.classList.remove('show'), 3000);
    }
}
