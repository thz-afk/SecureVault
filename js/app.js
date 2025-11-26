'use strict';

class App {
    constructor() {
        this.store = new VaultStore();
        this.currentBlock = 'default';
        this.pendingAction = null;
        this.editingNoteId = null;
        this.sessionTimerInterval = null;
        this.currentPerson = null;

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

        // Close modals on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }

    attachButtonListener(id, handler) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handler);
    }

    attachFormListener(id, handler) {
        const form = document.getElementById(id);
        if (form) form.addEventListener('submit', handler);
    }

    // ==================== IMPORT/EXPORT ====================

    async handleExport() {
        if (!this.store.isAuthenticated()) {
            this.showToast('Faça login para exportar', 'error');
            return;
        }

        const format = document.getElementById('exportFormat')?.value;
        const password = document.getElementById('exportFilePwd')?.value || '';
        const btn = document.getElementById('btnExportAction');

        if (!format) {
            this.showToast('Selecione um formato', 'error');
            return;
        }

        if ((format === 'kdbx' || format === 'json_enc') && !password) {
            this.showToast('Defina uma senha para proteger o arquivo', 'error');
            document.getElementById('exportFilePwd')?.focus();
            return;
        }

        const originalText = btn?.textContent || 'Exportar';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Gerando arquivo...';
        }

        try {
            let data, filename, mime;
            const dateStr = new Date().toISOString().slice(0, 10);

            switch (format) {
                case 'csv':
                    data = this.generateCSV();
                    filename = `SecureVault_Backup_${dateStr}.csv`;
                    mime = 'text/csv;charset=utf-8';
                    break;

                case 'json':
                    data = JSON.stringify(this.store.vault, null, 2);
                    filename = `SecureVault_Backup_${dateStr}.json`;
                    mime = 'application/json';
                    break;

                case 'json_enc':
                    const jsonStr = JSON.stringify(this.store.vault);
                    data = await this.encryptDataAES(jsonStr, password);
                    filename = `SecureVault_Encrypted_${dateStr}.json`;
                    mime = 'application/json';
                    break;

                case 'kdbx':
                    if (!window.kdbxweb) {
                        throw new Error('Biblioteca kdbxweb não carregada.');
                    }
                    data = await this.generateKDBX(password);
                    filename = `SecureVault_${dateStr}.kdbx`;
                    mime = 'application/octet-stream';
                    break;

                default:
                    throw new Error('Formato não suportado');
            }

            this.downloadFile(data, filename, mime);
            this.showToast('Backup gerado com sucesso!');
            this.closeModal('dbModal');

            const pwdInput = document.getElementById('exportFilePwd');
            if (pwdInput) pwdInput.value = '';

        } catch (err) {
            console.error('Export error:', err);
            this.showToast('Erro ao exportar: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }

    async handleImport() {
        const fileInput = document.getElementById('importFile');
        const file = fileInput?.files?.[0];
        const mode = document.getElementById('importMode')?.value || 'merge';
        const password = document.getElementById('importFilePwd')?.value || '';
        const btn = document.getElementById('btnImportAction');

        if (!file) {
            this.showToast('Selecione um arquivo primeiro', 'error');
            return;
        }

        const originalText = btn?.textContent || 'Importar';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Processando...';
        }

        try {
            let importedVault = { pwds: [], notes: [], blks: [] };
            const fileName = file.name.toLowerCase();

            if (fileName.endsWith('.csv')) {
                const rawText = await file.text();
                importedVault = this.parseCSV(rawText);

            } else if (fileName.endsWith('.json')) {
                const rawText = await file.text();
                let json;

                try {
                    json = JSON.parse(rawText);
                } catch (e) {
                    throw new Error('Arquivo JSON inválido');
                }

                // Check if encrypted
                if (json.salt && json.iv && json.data) {
                    if (!password) {
                        const pwdGroup = document.getElementById('importPwdGroup');
                        if (pwdGroup) pwdGroup.style.display = 'block';
                        throw new Error('Senha necessária para descriptografar');
                    }
                    const decryptedStr = await this.decryptDataAES(json, password);
                    importedVault = JSON.parse(decryptedStr);
                } else {
                    importedVault = json;
                }

            } else if (fileName.endsWith('.kdbx')) {
                if (!window.kdbxweb) {
                    throw new Error('Biblioteca kdbxweb necessária');
                }
                if (!password) {
                    const pwdGroup = document.getElementById('importPwdGroup');
                    if (pwdGroup) pwdGroup.style.display = 'block';
                    throw new Error('Senha necessária para arquivo .kdbx');
                }
                const arrayBuffer = await file.arrayBuffer();
                importedVault = await this.parseKDBX(arrayBuffer, password);

            } else {
                throw new Error('Formato não suportado. Use .kdbx, .csv ou .json');
            }

            // Validate imported data
            if (!importedVault || typeof importedVault !== 'object') {
                throw new Error('Dados inválidos no arquivo');
            }

            // Ensure arrays exist
            if (!Array.isArray(importedVault.pwds)) importedVault.pwds = [];
            if (!Array.isArray(importedVault.notes)) importedVault.notes = [];
            if (!Array.isArray(importedVault.blks)) importedVault.blks = [];

            if (importedVault.pwds.length === 0 && importedVault.notes.length === 0) {
                throw new Error('Nenhum dado válido encontrado no arquivo.');
            }

            if (mode === 'replace') {
                if (!confirm('ATENÇÃO: Isso apagará TODOS os dados atuais. Continuar?')) {
                    return;
                }

                this.store.vault = {
                    blks: importedVault.blks.length > 0 ? importedVault.blks : [{ id: 'default', name: 'Geral' }],
                    pwds: importedVault.pwds,
                    notes: importedVault.notes,
                    prs: importedVault.prs || []
                };

                // Ensure default block exists
                if (!this.store.vault.blks.find(b => b.id === 'default')) {
                    this.store.vault.blks.unshift({ id: 'default', name: 'Geral' });
                }

            } else {
                // Merge mode
                let pwdCount = 0;
                let noteCount = 0;

                importedVault.pwds.forEach(p => {
                    if (p && p.site) {
                        p.id = this.generateId('imp_pwd');
                        const blkExists = this.store.vault.blks?.find(b => b.id === p.blk);
                        if (!blkExists) p.blk = 'default';
                        if (!this.store.vault.pwds) this.store.vault.pwds = [];
                        this.store.vault.pwds.push(p);
                        pwdCount++;
                    }
                });

                importedVault.notes.forEach(n => {
                    if (n && n.title) {
                        n.id = this.generateId('imp_note');
                        const blkExists = this.store.vault.blks?.find(b => b.id === n.blk);
                        if (!blkExists) n.blk = 'default';
                        if (!this.store.vault.notes) this.store.vault.notes = [];
                        this.store.vault.notes.push(n);
                        noteCount++;
                    }
                });

                const totalCount = pwdCount + noteCount;
                this.showToast(`${totalCount} itens importados (${pwdCount} senhas, ${noteCount} notas).`);
            }

            await this.store.saveVault();
            this.loadBlocks();
            this.loadPasswords();
            this.loadNotes();
            this.closeModal('dbModal');

            // Reset form
            if (fileInput) fileInput.value = '';
            const importPwd = document.getElementById('importFilePwd');
            if (importPwd) importPwd.value = '';
            const importPwdGroup = document.getElementById('importPwdGroup');
            if (importPwdGroup) importPwdGroup.style.display = 'none';

        } catch (err) {
            console.error('Import error:', err);
            let msg = err.message;

            if (err.code === 'InvalidKey') {
                msg = 'Senha incorreta do arquivo KDBX.';
            }
            if (msg.includes('argon2')) {
                msg = 'Este arquivo usa Argon2 (não suportado). Exporte como AES no KeePass.';
            }

            this.showToast('Erro: ' + msg, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }

    // ==================== EXPORT HELPERS ====================

    generateCSV() {
        const vault = this.store.vault;
        if (!vault) return '';

        const pwds = vault.pwds || [];
        const blks = vault.blks || [];

        const header = ['Bloco', 'Site', 'Usuario', 'Senha', 'Notas'];
        const escapeCSV = (text) => {
            const str = String(text || '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const rows = pwds.map(p => {
            const blkName = blks.find(b => b.id === p.blk)?.name || 'Geral';
            return [
                escapeCSV(blkName),
                escapeCSV(p.site),
                escapeCSV(p.usr),
                escapeCSV(p.val),
                escapeCSV('')
            ].join(',');
        });

        return '\uFEFF' + [header.join(','), ...rows].join('\r\n'); // BOM for Excel compatibility
    }

    async generateKDBX(password) {
        const safePassword = String(password || '');
        const credentials = new kdbxweb.Credentials(
            kdbxweb.ProtectedValue.fromString(safePassword)
        );

        const db = kdbxweb.Kdbx.create(credentials, 'SecureVault Export');

        // Try to set AES KDF for compatibility
        if (typeof db.setKdf === 'function') {
            try {
                db.setKdf(kdbxweb.Consts.KdfId.Aes);
            } catch (e) {
                console.warn('KDBX: Could not set AES KDF, using default.', e);
            }
        }

        const defaultGroup = db.getDefaultGroup();
        defaultGroup.name = 'SecureVault';

        const groupMap = { 'default': defaultGroup };
        const vault = this.store.vault;

        // Create groups for blocks
        if (vault.blks) {
            vault.blks.forEach(blk => {
                if (blk.id !== 'default') {
                    const blkName = String(blk.name || 'Sem Nome');
                    const grp = db.createGroup(defaultGroup, blkName);
                    groupMap[blk.id] = grp;
                }
            });
        }

        // Add passwords
        if (vault.pwds) {
            vault.pwds.forEach(p => {
                const targetGroup = groupMap[p.blk] || defaultGroup;
                const entry = db.createEntry(targetGroup);

                const safeTitle = String(p.site || 'Sem Título');
                const safeUser = String(p.usr || '');
                const safePass = String(p.val || '');
                const safeUrl = String(p.site || '');

                entry.fields.set('Title', safeTitle);
                entry.fields.set('UserName', safeUser);
                entry.fields.set('URL', safeUrl);

                try {
                    const protectedPass = kdbxweb.ProtectedValue.fromString(safePass);
                    entry.fields.set('Password', protectedPass);
                } catch (e) {
                    console.warn('Error protecting password, saving as plain text', e);
                    entry.fields.set('Password', safePass);
                }

                entry.times.creationTime = new Date();
                entry.times.lastModificationTime = new Date();
            });
        }

        return await db.save();
    }

    // ==================== IMPORT HELPERS ====================

    parseCSV(text) {
        const vault = { blks: [{ id: 'default', name: 'Geral' }], pwds: [], notes: [] };

        if (!text || typeof text !== 'string') return vault;

        const lines = text.split(/\r?\n/);
        if (lines.length < 2) return vault;

        // Parse CSV properly handling quoted fields
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = line[i + 1];

                if (inQuotes) {
                    if (char === '"' && nextChar === '"') {
                        current += '"';
                        i++;
                    } else if (char === '"') {
                        inQuotes = false;
                    } else {
                        current += char;
                    }
                } else {
                    if (char === '"') {
                        inQuotes = true;
                    } else if (char === ',') {
                        result.push(current);
                        current = '';
                    } else {
                        current += char;
                    }
                }
            }
            result.push(current);
            return result;
        };

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = parseCSVLine(line);

            if (cols.length >= 3) {
                vault.pwds.push({
                    id: this.generateId('csv_pwd'),
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
        const credentials = new kdbxweb.Credentials(
            kdbxweb.ProtectedValue.fromString(safePassword)
        );

        const db = await kdbxweb.Kdbx.load(arrayBuffer, credentials);
        const vault = { blks: [{ id: 'default', name: 'Geral' }], pwds: [], notes: [] };

        const traverse = (group) => {
            if (!group) return;

            if (group.entries) {
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

                    if (title || user || passVal) {
                        vault.pwds.push({
                            id: this.generateId('kdbx_pwd'),
                            blk: 'default',
                            site: String(title),
                            usr: String(user),
                            val: passVal
                        });
                    }
                });
            }

            if (group.groups) {
                group.groups.forEach(g => traverse(g));
            }
        };

        const defaultGroup = db.getDefaultGroup();
        if (defaultGroup) {
            traverse(defaultGroup);
        }

        return vault;
    }

    // ==================== ENCRYPTION ====================

    async encryptDataAES(dataStr, pwd) {
        const enc = new TextEncoder();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(pwd),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const key = await window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: 600000, // Updated to modern recommendation
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        const encrypted = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(dataStr)
        );

        const toB64 = (u8) => btoa(String.fromCharCode(...u8));

        return JSON.stringify({
            salt: toB64(salt),
            iv: toB64(iv),
            data: toB64(new Uint8Array(encrypted)),
            iterations: 600000 // Store for future compatibility
        });
    }

    async decryptDataAES(jsonObj, pwd) {
        const fromB64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));

        const salt = fromB64(jsonObj.salt);
        const iv = fromB64(jsonObj.iv);
        const data = fromB64(jsonObj.data);
        const iterations = jsonObj.iterations || 100000; // Backward compatibility

        const enc = new TextEncoder();

        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(pwd),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const key = await window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );

        return new TextDecoder().decode(decrypted);
    }

    // ==================== FILE DOWNLOAD ====================

    downloadFile(content, filename, mime) {
        const blob = (content instanceof ArrayBuffer)
            ? new Blob([content], { type: mime })
            : (content instanceof Blob)
                ? content
                : new Blob([content], { type: mime });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Give more time for large files
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // ==================== AUTHENTICATION UI ====================

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

        if (typeof Security !== 'undefined' && !Security.checkRate('auth')) {
            this.showToast('Muitas tentativas. Aguarde 1 minuto.', 'error');
            return;
        }

        const pwdInput = document.getElementById('masterPwd');
        const confInput = document.getElementById('confirmPwd');
        const btn = document.getElementById('authBtn');

        if (!pwdInput) return;

        const password = pwdInput.value;
        const confirm = confInput ? confInput.value : '';

        if (typeof Security !== 'undefined' && !Security.validate(password, 128)) {
            this.showToast('Senha contém caracteres inválidos', 'error');
            return;
        }

        if (btn) btn.disabled = true;

        try {
            const extSession = document.getElementById('extendSession');
            let sessDuration = extSession?.checked ? 1800000 : 300000; // 30min or 5min

            if (this.store.hasValidSession()) {
                const rem = this.store.getSessionTimeRemaining();
                if (rem > 0) {
                    sessDuration = rem + (extSession?.checked ? 1800000 : 300000);
                }
            }

            if (this.store.exists()) {
                const success = await this.store.openVault(password, sessDuration);
                if (success) {
                    this.enterDashboard();
                } else {
                    this.showToast('Senha incorreta', 'error');
                }
            } else {
                if (password.length < 8) {
                    this.showToast('Senha deve ter pelo menos 8 caracteres', 'error');
                    return;
                }
                if (password !== confirm) {
                    this.showToast('Senhas não coincidem', 'error');
                    return;
                }
                await this.store.createVault(password, sessDuration);
                this.enterDashboard();
            }
        } catch (err) {
            console.error('Auth error:', err);
            this.showToast('Erro na autenticação', 'error');
        } finally {
            pwdInput.value = '';
            if (confInput) confInput.value = '';
            if (btn) btn.disabled = false;
        }
    }

    async handleReAuth(e) {
        e.preventDefault();

        if (typeof Security !== 'undefined' && !Security.checkRate('reauth')) {
            this.showToast('Muitas tentativas. Aguarde.', 'error');
            return;
        }

        const pwdInput = document.getElementById('authPwd');
        if (!pwdInput) return;

        const password = pwdInput.value;

        if (typeof Security !== 'undefined' && !Security.validate(password, 128)) {
            this.showToast('Senha inválida', 'error');
            return;
        }

        try {
            const success = await this.store.reAuthenticate(password);
            if (success) {
                this.closeModal('authModal');
                if (this.pendingAction) {
                    const action = this.pendingAction;
                    this.pendingAction = null;
                    action();
                }
                this.showToast('Autenticado', 'success');
            } else {
                this.showToast('Senha incorreta', 'error');
            }
        } catch (err) {
            console.error('Reauth error:', err);
            this.showToast('Erro na autenticação', 'error');
        } finally {
            pwdInput.value = '';
        }
    }

    enterDashboard() {
        if (!this.store.isAuthenticated()) {
            this.showToast('Autenticação necessária', 'error');
            return;
        }

        const authScreen = document.getElementById('authScreen');
        const dashboard = document.getElementById('dashboard');

        if (authScreen) authScreen.style.display = 'none';
        if (dashboard) dashboard.style.display = 'block';

        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        this.startSessionTimer();
        this.showToast('Bem-vindo!', 'success');
    }

    // ==================== SESSION MANAGEMENT ====================

    startSessionTimer() {
        // Clear any existing timer to prevent stacking
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
            this.sessionTimerInterval = null;
        }

        this.updateSessionTimer();
        this.sessionTimerInterval = setInterval(() => this.updateSessionTimer(), 1000);
    }

    stopSessionTimer() {
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
            this.sessionTimerInterval = null;
        }
    }

    updateSessionTimer() {
        const timerDisp = document.getElementById('timerDisplay');
        const extendBtn = document.getElementById('extendSessionBtn');

        if (!timerDisp) return;

        if (!this.store.isAuthenticated()) {
            timerDisp.textContent = 'Expirada';
            timerDisp.style.color = 'var(--danger)';
            if (extendBtn) extendBtn.disabled = true;
            this.handleSessionExpired();
            return;
        }

        const rem = this.store.getSessionTimeRemaining();

        if (rem <= 0) {
            timerDisp.textContent = 'Expirada';
            timerDisp.style.color = 'var(--danger)';
            if (extendBtn) extendBtn.disabled = true;
            this.handleSessionExpired();
            return;
        }

        const totalSec = Math.floor(rem / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        timerDisp.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

        if (totalSec < 60) {
            timerDisp.style.color = 'var(--danger)';
        } else if (totalSec < 300) {
            timerDisp.style.color = 'var(--warn)';
        } else {
            timerDisp.style.color = 'var(--txt-sec)';
        }

        if (extendBtn) extendBtn.disabled = false;
    }

    handleSessionExpired() {
        this.stopSessionTimer();
        this.showToast('Sessão expirada. Faça login novamente.', 'error');
        // Don't auto-logout, just require re-auth for sensitive actions
    }

    extendSession() {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.extendSession());
            return;
        }

        if (this.store.extendSession(30)) {
            this.showToast('Sessão prolongada em 30 minutos', 'success');
            this.updateSessionTimer();
        } else {
            this.showToast('Não foi possível estender a sessão', 'error');
        }
    }

    checkAuthAndDo(action) {
        if (this.store.isAuthenticated()) {
            action();
        } else {
            this.pendingAction = action;
            this.openModal('authModal');
        }
    }

    logout() {
        if (confirm('Deseja sair?')) {
            this.stopSessionTimer();
            this.store.lock();
            this.currentPerson = null;
            this.pendingAction = null;
            this.editingNoteId = null;
            location.reload();
        }
    }

    // ==================== SECTION NAVIGATION ====================

    switchSection(e) {
        const section = e.currentTarget.dataset.section;
        if (!section) return;

        const sensitiveSections = ['passwords', 'notes'];

        if (sensitiveSections.includes(section) && !this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.switchSection(e));
            return;
        }

        // Update menu
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });
        e.currentTarget.classList.add('active');

        // Update sections
        document.querySelectorAll('.section').forEach(sec => {
            sec.classList.remove('active');
        });

        const targetSec = document.getElementById(section);
        if (targetSec) targetSec.classList.add('active');

        // Load data if authenticated
        if (this.store.isAuthenticated()) {
            if (section === 'passwords') this.loadPasswords();
            else if (section === 'notes') this.loadNotes();
        }
    }

    // ==================== BLOCKS ====================

    loadBlocks() {
        const container = document.getElementById('blkList');
        if (!container) return;

        if (!this.store.isAuthenticated()) {
            container.innerHTML = '';
            return;
        }

        if (!this.store.vault?.blks) return;

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
                delBtn.title = 'Excluir bloco';
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
        if (!nameInput) return;

        const name = nameInput.value.trim();

        if (!name) {
            this.showToast('Digite um nome para o bloco', 'error');
            return;
        }

        if (typeof Security !== 'undefined' && !Security.validate(name, 50)) {
            this.showToast('Nome inválido', 'error');
            return;
        }

        const id = this.generateId('blk');

        if (!this.store.vault.blks) this.store.vault.blks = [];
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

        const block = this.store.vault.blks?.find(b => b.id === id);
        const blockName = block?.name || 'este bloco';

        if (!confirm(`Excluir "${blockName}" e todo seu conteúdo?`)) return;

        this.store.vault.blks = this.store.vault.blks.filter(b => b.id !== id);
        this.store.vault.pwds = (this.store.vault.pwds || []).filter(p => p.blk !== id);
        this.store.vault.notes = (this.store.vault.notes || []).filter(n => n.blk !== id);

        await this.store.saveVault();

        if (this.currentBlock === id) {
            this.currentBlock = 'default';
        }

        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        this.showToast('Bloco excluído');
    }

    // ==================== PASSWORDS ====================

    loadPasswords() {
        const container = document.getElementById('pwdList');
        if (!container) return;

        if (!this.store.isAuthenticated()) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            return;
        }

        if (!this.store.vault) return;

        const pwds = (this.store.vault.pwds || []).filter(p => p.blk === this.currentBlock);

        if (pwds.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma senha salva neste bloco</p>';
            return;
        }

        container.innerHTML = '';

        pwds.forEach(pwd => {
            const card = document.createElement('div');
            card.className = 'pwd-card';

            // Header
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

            // Details
            const details = document.createElement('div');
            details.className = 'pwd-details';
            details.id = `pwd-${pwd.id}`;

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
            showBtn.textContent = '👁';
            showBtn.title = 'Mostrar/ocultar senha';
            showBtn.addEventListener('click', () => this.togglePasswordVisibility(pwd.id));

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-icon';
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copiar senha';
            copyBtn.addEventListener('click', () => this.copyPassword(pwd.id));

            wrap.appendChild(value);
            wrap.appendChild(showBtn);
            wrap.appendChild(copyBtn);

            field.appendChild(label);
            field.appendChild(wrap);

            // Actions
            const actions = document.createElement('div');
            actions.style.marginTop = '16px';
            actions.style.display = 'flex';
            actions.style.gap = '8px';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary';
            editBtn.textContent = 'Editar';
            editBtn.addEventListener('click', () => this.openPasswordModal(pwd));

            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Excluir';
            delBtn.addEventListener('click', () => this.deletePassword(pwd.id));

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);

            details.appendChild(field);
            details.appendChild(actions);

            // Toggle details on header click
            header.addEventListener('click', (e) => {
                if (e.target.tagName !== 'BUTTON') {
                    details.classList.toggle('show');
                    expandBtn.textContent = details.classList.contains('show') ? 'Ver Menos' : 'Ver Mais';
                }
            });

            expandBtn.addEventListener('click', () => {
                details.classList.toggle('show');
                expandBtn.textContent = details.classList.contains('show') ? 'Ver Menos' : 'Ver Mais';
            });

            card.appendChild(header);
            card.appendChild(details);
            container.appendChild(card);
        });
    }

    openPasswordModal(pwd = null) {
        const select = document.getElementById('pwdBlk');
        const siteInput = document.getElementById('pwdSite');
        const usrInput = document.getElementById('pwdUsr');
        const valInput = document.getElementById('pwdVal');
        const modalTitle = document.querySelector('#pwdModal .modal-title');
        const form = document.getElementById('pwdForm');

        if (!select || !this.store.vault?.blks) return;

        // Store editing state
        this.editingPasswordId = pwd ? pwd.id : null;

        if (modalTitle) {
            modalTitle.textContent = pwd ? 'Editar Senha' : 'Nova Senha';
        }

        // Populate block select
        select.innerHTML = '';
        this.store.vault.blks.forEach(blk => {
            const option = document.createElement('option');
            option.value = blk.id;
            option.textContent = blk.name;
            if ((pwd && blk.id === pwd.blk) || (!pwd && blk.id === this.currentBlock)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Fill form if editing
        if (pwd) {
            if (siteInput) siteInput.value = pwd.site || '';
            if (usrInput) usrInput.value = pwd.usr || '';
            if (valInput) valInput.value = pwd.val || '';
        } else {
            if (form) form.reset();
        }

        this.openModal('pwdModal');
    }

    async savePassword(e) {
        e.preventDefault();

        if (!this.store.isAuthenticated()) return;

        const blk = document.getElementById('pwdBlk')?.value;
        const site = document.getElementById('pwdSite')?.value?.trim();
        const usr = document.getElementById('pwdUsr')?.value?.trim();
        const val = document.getElementById('pwdVal')?.value;

        if (!site) {
            this.showToast('Digite o nome do site', 'error');
            return;
        }

        if (!val) {
            this.showToast('Digite a senha', 'error');
            return;
        }

        if (typeof Security !== 'undefined') {
            if (!Security.validate(site, 100) || !Security.validate(usr, 200) || !Security.validate(val, 500)) {
                this.showToast('Dados inválidos', 'error');
                return;
            }
        }

        if (!this.store.vault.pwds) this.store.vault.pwds = [];

        if (this.editingPasswordId) {
            // Update existing
            const idx = this.store.vault.pwds.findIndex(p => p.id === this.editingPasswordId);
            if (idx !== -1) {
                this.store.vault.pwds[idx] = {
                    id: this.editingPasswordId,
                    blk,
                    site,
                    usr,
                    val
                };
            }
            this.editingPasswordId = null;
            this.showToast('Senha atualizada');
        } else {
            // Create new
            const pwd = {
                id: this.generateId('pwd'),
                blk,
                site,
                usr,
                val
            };
            this.store.vault.pwds.push(pwd);
            this.showToast('Senha salva');
        }

        await this.store.saveVault();
        this.loadPasswords();
        this.closeModal('pwdModal');
        e.target.reset();
    }

    togglePasswordVisibility(id) {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.togglePasswordVisibility(id));
            return;
        }

        const element = document.getElementById(`pwdval-${id}`);
        if (!element) return;

        const pwd = this.store.vault?.pwds?.find(p => p.id === id);
        if (!pwd) return;

        if (element.textContent === '••••••••') {
            element.textContent = pwd.val;
            // Auto-hide after 30 seconds
            setTimeout(() => {
                if (element.textContent !== '••••••••') {
                    element.textContent = '••••••••';
                }
            }, 30000);
        } else {
            element.textContent = '••••••••';
        }
    }

    copyPassword(id) {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.copyPassword(id));
            return;
        }

        const pwd = this.store.vault?.pwds?.find(p => p.id === id);
        if (!pwd) return;

        navigator.clipboard.writeText(pwd.val)
            .then(() => {
                this.showToast('Senha copiada');
                // Clear clipboard after 30 seconds
                setTimeout(() => {
                    navigator.clipboard.writeText('').catch(() => {});
                }, 30000);
            })
            .catch(() => this.showToast('Erro ao copiar', 'error'));
    }

    async deletePassword(id) {
        if (!this.store.isAuthenticated()) return;

        const pwd = this.store.vault?.pwds?.find(p => p.id === id);
        const siteName = pwd?.site || 'esta senha';

        if (!confirm(`Excluir "${siteName}"?`)) return;

        this.store.vault.pwds = (this.store.vault.pwds || []).filter(p => p.id !== id);
        await this.store.saveVault();
        this.loadPasswords();
        this.showToast('Senha excluída');
    }

    // ==================== PASSWORD GENERATOR ====================

    generatePassword() {
        const len = parseInt(document.getElementById('genLen')?.value) || 16;
        const upper = document.getElementById('genUpper')?.checked;
        const lower = document.getElementById('genLower')?.checked;
        const num = document.getElementById('genNum')?.checked;
        const sym = document.getElementById('genSym')?.checked;

        let charset = '';
        if (upper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (lower) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (num) charset += '0123456789';
        if (sym) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

        if (!charset) {
            this.showToast('Selecione pelo menos uma opção', 'error');
            return;
        }

        const password = this.generateSecureString(charset, len);

        const input = document.getElementById('genPwd');
        if (input) input.value = password;

        // Show strength indicator
        this.updatePasswordStrength(password);
    }

    generateSecureString(charset, length) {
        let result = '';
        const array = new Uint32Array(length);
        window.crypto.getRandomValues(array);

        for (let i = 0; i < length; i++) {
            result += charset[array[i] % charset.length];
        }

        return result;
    }

    updatePasswordStrength(password) {
        // Simple strength calculation
        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (password.length >= 16) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;

        const strengthEl = document.getElementById('pwdStrength');
        if (strengthEl) {
            const labels = ['Muito Fraca', 'Fraca', 'Razoável', 'Boa', 'Forte', 'Muito Forte', 'Excelente'];
            const colors = ['#ff4444', '#ff8800', '#ffcc00', '#88cc00', '#44bb00', '#00aa44', '#00ff88'];
            const idx = Math.min(score, labels.length - 1);
            strengthEl.textContent = labels[idx];
            strengthEl.style.color = colors[idx];
        }
    }

    copyGenerated() {
        const input = document.getElementById('genPwd');
        if (input?.value) {
            navigator.clipboard.writeText(input.value)
                .then(() => {
                    this.showToast('Senha copiada!');
                    // Clear clipboard after 30 seconds
                    setTimeout(() => {
                        navigator.clipboard.writeText('').catch(() => {});
                    }, 30000);
                })
                .catch(() => this.showToast('Erro ao copiar', 'error'));
        } else {
            this.showToast('Gere uma senha primeiro', 'error');
        }
    }

    generateQuickPassword() {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        const password = this.generateSecureString(charset, 16);

        const input = document.getElementById('pwdVal');
        if (input) input.value = password;
    }

    // ==================== PERSON GENERATOR ====================

    generateName() {
        const firstNames = [
            'João', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Julia', 'Lucas', 'Mariana',
            'Rafael', 'Beatriz', 'André', 'Fernanda', 'Gabriel', 'Larissa', 'Bruno',
            'Camila', 'Diego', 'Patricia', 'Rodrigo', 'Natália', 'Felipe', 'Aline',
            'Gustavo', 'Isabela', 'Thiago', 'Renata', 'Eduardo', 'Carolina',
            'Matheus', 'Amanda', 'Leonardo', 'Letícia', 'Vinícius', 'Juliana',
            'Marcelo', 'Bruna', 'Daniel', 'Vanessa', 'Ricardo', 'Priscila'
        ];

        const lastNames = [
            'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Costa', 'Ferreira',
            'Gomes', 'Ribeiro', 'Almeida', 'Pereira', 'Rodrigues', 'Martins',
            'Barbosa', 'Araújo', 'Cardoso', 'Melo', 'Correia', 'Teixeira', 'Dias',
            'Nunes', 'Batista', 'Freitas', 'Vieira', 'Rocha', 'Carvalho', 'Moreira',
            'Nascimento', 'Monteiro', 'Mendes', 'Barros', 'Cavalcante', 'Campos'
        ];

        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

        return `${firstName} ${lastName}`;
    }

    generateBirthdate() {
        const year = 1950 + Math.floor(Math.random() * 55); // 1950-2004
        const month = Math.floor(Math.random() * 12) + 1;

        // Adjust days based on month
        let maxDay = 28;
        if ([1, 3, 5, 7, 8, 10, 12].includes(month)) {
            maxDay = 31;
        } else if ([4, 6, 9, 11].includes(month)) {
            maxDay = 30;
        }

        const day = Math.floor(Math.random() * maxDay) + 1;

        return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    }

    generateAddress() {
        // Use StreetsData from streets.js if available
        let street;

        if (typeof StreetsData !== 'undefined' && Array.isArray(StreetsData) && StreetsData.length > 0) {
            street = StreetsData[Math.floor(Math.random() * StreetsData.length)];
        } else if (typeof window.StreetsData !== 'undefined' && Array.isArray(window.StreetsData) && window.StreetsData.length > 0) {
            street = window.StreetsData[Math.floor(Math.random() * window.StreetsData.length)];
        } else {
            // Fallback streets if StreetsData is not available
            const fallbackStreets = [
                'Rua das Flores',
                'Av. Brasil',
                'Rua Principal',
                'Rua 15 de Novembro',
                'Av. Paulista',
                'Rua do Comércio',
                'Av. Atlântica',
                'Rua da Praia',
                'Rua São Paulo',
                'Av. Rio Branco',
                'Rua das Palmeiras',
                'Rua dos Pinheiros'
            ];
            street = fallbackStreets[Math.floor(Math.random() * fallbackStreets.length)];
            console.warn('StreetsData not found, using fallback streets. Make sure streets.js is loaded.');
        }

        const number = Math.floor(Math.random() * 9999) + 1;
        return `${street}, ${number}`;
    }

    generateCPF() {
        const nums = [];

        // Generate first 9 digits
        for (let i = 0; i < 9; i++) {
            nums.push(Math.floor(Math.random() * 10));
        }

        // Calculate first verification digit
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += nums[i] * (10 - i);
        }
        let d1 = 11 - (sum % 11);
        if (d1 >= 10) d1 = 0;
        nums.push(d1);

        // Calculate second verification digit
        sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += nums[i] * (11 - i);
        }
        let d2 = 11 - (sum % 11);
        if (d2 >= 10) d2 = 0;
        nums.push(d2);

        // Format CPF
        return `${nums.slice(0, 3).join('')}.${nums.slice(3, 6).join('')}.${nums.slice(6, 9).join('')}-${nums.slice(9, 11).join('')}`;
    }

    generateEmail(name) {
        // Generate email based on name
        const cleanName = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/\s+/g, '');

        const randomNum = Math.floor(Math.random() * 9999);
        const emailUser = `${cleanName}${randomNum}`;

        const service = this.store.config?.emailSvc || 'tuamae';

        let email, link;
        if (service === 'tuamae') {
            email = `${emailUser}@tuamaeaquelaursa.com`;
            link = `https://tuamaeaquelaursa.com/${emailUser}`;
        } else {
            email = `${emailUser}@firemail.com.br`;
            link = `https://firemail.com.br/${emailUser}`;
        }

        return { email, link, user: emailUser };
    }

    generatePerson() {
        const name = this.generateName();
        const cpf = this.generateCPF();
        const birthdate = this.generateBirthdate();
        const address = this.generateAddress();
        const emailData = this.generateEmail(name);

        this.currentPerson = {
            name,
            cpf,
            birthdate,
            email: emailData.email,
            link: emailData.link,
            emailUser: emailData.user,
            address
        };

        this.displayPerson(this.currentPerson);
    }

    regenerateField(field) {
        if (!this.currentPerson) {
            this.generatePerson();
            return;
        }

        switch (field) {
            case 'name':
                this.currentPerson.name = this.generateName();
                const emailData = this.generateEmail(this.currentPerson.name);
                this.currentPerson.email = emailData.email;
                this.currentPerson.link = emailData.link;
                this.currentPerson.emailUser = emailData.user;
                break;
            case 'cpf':
                this.currentPerson.cpf = this.generateCPF();
                break;
            case 'birthdate':
                this.currentPerson.birthdate = this.generateBirthdate();
                break;
            case 'address':
                this.currentPerson.address = this.generateAddress();
                break;
        }

        this.displayPerson(this.currentPerson);
    }

    displayPerson(person) {
        const container = document.getElementById('personContent');
        if (!container) return;

        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'person-card';

        const fields = [
            { label: 'Nome', value: person.name, key: 'name', regenerate: true },
            { label: 'CPF', value: person.cpf, key: 'cpf', regenerate: true },
            { label: 'Nascimento', value: person.birthdate, key: 'birthdate', regenerate: true },
            { label: 'Email', value: person.email, key: 'email', hasEmailActions: true },
            { label: 'Endereço', value: person.address, key: 'address', regenerate: true }
        ];

        fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'person-field';

            const label = document.createElement('span');
            label.className = 'field-label';
            label.textContent = `${field.label}:`;

            const valDiv = document.createElement('div');
            valDiv.className = 'field-value';

            const textSpan = document.createElement('span');
            textSpan.id = `person${field.key.charAt(0).toUpperCase() + field.key.slice(1)}`;
            textSpan.textContent = field.value;
            valDiv.appendChild(textSpan);

            // Copy button for all fields
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-icon';
            copyBtn.textContent = '';
            copyBtn.title = 'Copiar';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(field.value)
                    .then(() => this.showToast('Copiado!'))
                    .catch(() => this.showToast('Erro ao copiar', 'error'));
            });
            valDiv.appendChild(copyBtn);

            // Email-specific actions
            if (field.hasEmailActions) {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-icon';
                editBtn.textContent = '✏';
                editBtn.title = 'Trocar domínio';
                editBtn.addEventListener('click', () => this.changeEmailDomain());
                valDiv.appendChild(editBtn);

                const linkBtn = document.createElement('button');
                linkBtn.className = 'btn-icon';
                linkBtn.textContent = '↗';
                linkBtn.title = 'Abrir caixa de entrada';
                linkBtn.addEventListener('click', () => {
                    if (this.currentPerson?.link) {
                        window.open(this.currentPerson.link, '_blank');
                    }
                });
                valDiv.appendChild(linkBtn);
            }

            // Regenerate button
            if (field.regenerate) {
                const regenBtn = document.createElement('button');
                regenBtn.className = 'btn-icon';
                regenBtn.textContent = '↻';
                regenBtn.title = 'Gerar novo';
                regenBtn.addEventListener('click', () => this.regenerateField(field.key));
                valDiv.appendChild(regenBtn);
            }

            div.appendChild(label);
            div.appendChild(valDiv);
            card.appendChild(div);
        });

        container.appendChild(card);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = 'Salvar Preset';
        saveBtn.addEventListener('click', () => this.savePerson());

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = ' Copiar Tudo';
        copyBtn.addEventListener('click', () => this.copyPerson(person));

        const newBtn = document.createElement('button');
        newBtn.className = 'btn btn-secondary';
        newBtn.textContent = '🔄 Gerar Nova';
        newBtn.addEventListener('click', () => this.generatePerson());

        actions.appendChild(saveBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(newBtn);
        container.appendChild(actions);
    }

    changeEmailDomain() {
        if (!this.currentPerson) return;

        const currentEmail = this.currentPerson.email;
        const user = this.currentPerson.emailUser;

        let newEmail, newLink;

        if (currentEmail.includes('@tuamaeaquelaursa')) {
            newEmail = `${user}@firemail.com.br`;
            newLink = `https://firemail.com.br/${user}`;
        } else {
            newEmail = `${user}@tuamaeaquelaursa.com`;
            newLink = `https://tuamaeaquelaursa.com/${user}`;
        }

        this.currentPerson.email = newEmail;
        this.currentPerson.link = newLink;

        // Update display
        const emailEl = document.getElementById('personEmail');
        if (emailEl) emailEl.textContent = newEmail;

        this.showToast('Domínio alterado');
    }

    async savePerson() {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.savePerson());
            return;
        }

        if (!this.currentPerson) {
            this.showToast('Gere uma pessoa primeiro', 'error');
            return;
        }

        const personToSave = {
            ...this.currentPerson,
            id: this.generateId('prs'),
            savedAt: new Date().toISOString()
        };

        if (!this.store.vault.prs) this.store.vault.prs = [];
        this.store.vault.prs.push(personToSave);

        await this.store.saveVault();
        this.showToast('Pessoa salva com sucesso!');
    }

    copyPerson(person) {
        const text = `Nome: ${person.name}
CPF: ${person.cpf}
Nascimento: ${person.birthdate}
Email: ${person.email}
Endereço: ${person.address}`;

        navigator.clipboard.writeText(text)
            .then(() => this.showToast('Dados copiados!'))
            .catch(() => this.showToast('Erro ao copiar', 'error'));
    }

    showSavedPersons() {
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.showSavedPersons());
            return;
        }

        const container = document.getElementById('personContent');
        if (!container) return;

        const persons = this.store.vault?.prs || [];

        if (persons.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma pessoa salva</p>';
            return;
        }

        container.innerHTML = '<h3 style="margin-bottom:16px;">Pessoas Salvas</h3>';

        persons.forEach(person => {
            const card = document.createElement('div');
            card.className = 'person-card';
            card.style.marginBottom = '12px';

            const fields = [
                { label: 'Nome', value: person.name },
                { label: 'CPF', value: person.cpf },
                { label: 'Email', value: person.email }
            ];

            fields.forEach(field => {
                const div = document.createElement('div');
                div.className = 'person-field';
                div.innerHTML = `
                    <span class="field-label">${field.label}:</span>
                    <span class="field-value">${field.value}</span>
                `;
                card.appendChild(div);
            });

            // Actions
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;';

            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn-icon';
            viewBtn.textContent = '';
            viewBtn.title = 'Ver detalhes';
            viewBtn.addEventListener('click', () => this.displayPerson(person));

            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-icon';
            copyBtn.textContent = '';
            copyBtn.title = 'Copiar dados';
            copyBtn.addEventListener('click', () => this.copyPerson(person));

            const mailBtn = document.createElement('button');
            mailBtn.className = 'btn-icon';
            mailBtn.textContent = '↗';
            mailBtn.title = 'Abrir email';
            mailBtn.addEventListener('click', () => {
                if (person.link) window.open(person.link, '_blank');
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon';
            delBtn.textContent = '🗑';
            delBtn.title = 'Excluir';
            delBtn.addEventListener('click', () => this.deletePerson(person.id));

            actions.appendChild(viewBtn);
            actions.appendChild(copyBtn);
            actions.appendChild(mailBtn);
            actions.appendChild(delBtn);
            card.appendChild(actions);

            container.appendChild(card);
        });

        // Back button
        const backBtn = document.createElement('button');
        backBtn.className = 'btn btn-secondary';
        backBtn.textContent = '← Voltar';
        backBtn.style.marginTop = '16px';
        backBtn.addEventListener('click', () => {
            if (this.currentPerson) {
                this.displayPerson(this.currentPerson);
            } else {
                container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Clique em "Gerar Pessoa" para começar</p>';
            }
        });
        container.appendChild(backBtn);
    }

    async deletePerson(id) {
        if (!this.store.isAuthenticated()) return;

        if (!confirm('Excluir esta pessoa salva?')) return;

        this.store.vault.prs = (this.store.vault.prs || []).filter(p => p.id !== id);
        await this.store.saveVault();
        this.showSavedPersons();
        this.showToast('Pessoa excluída');
    }

    // ==================== NOTES ====================

    loadNotes() {
        const container = document.getElementById('notesList');
        if (!container) return;

        if (!this.store.isAuthenticated()) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            return;
        }

        if (!this.store.vault) return;

        const notes = (this.store.vault.notes || []).filter(n => n.blk === this.currentBlock);

        if (notes.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma anotação neste bloco</p>';
            return;
        }

        container.innerHTML = '';

        notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

            const title = document.createElement('div');
            title.className = 'note-title';
            title.textContent = note.title;
            title.style.cursor = 'pointer';
            title.addEventListener('click', () => this.showNoteDetail(note));

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-icon';
            editBtn.textContent = '✏';
            editBtn.title = 'Editar';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openNoteModal(note);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon';
            delBtn.textContent = '🗑';
            delBtn.title = 'Excluir';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteNote(note.id);
            });

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            header.appendChild(title);
            header.appendChild(actions);

            const preview = document.createElement('div');
            preview.className = 'note-preview';
            preview.style.cursor = 'pointer';

            const maxLen = 150;
            if (note.content.length > maxLen) {
                preview.textContent = note.content.substring(0, maxLen) + '...';
            } else {
                preview.textContent = note.content;
            }

            preview.addEventListener('click', () => this.showNoteDetail(note));

            card.appendChild(header);
            card.appendChild(preview);
            container.appendChild(card);
        });
    }

    openNoteModal(note = null) {
        const select = document.getElementById('noteBlk');
        const titleInput = document.getElementById('noteTitle');
        const contentInput = document.getElementById('noteContent');
        const modalTitle = document.querySelector('#noteModal .modal-title');

        if (!select || !this.store.vault?.blks) return;

        this.editingNoteId = note ? note.id : null;

        if (modalTitle) {
            modalTitle.textContent = note ? 'Editar Anotação' : 'Nova Anotação';
        }

        // Populate block select
        select.innerHTML = '';
        this.store.vault.blks.forEach(blk => {
            const option = document.createElement('option');
            option.value = blk.id;
            option.textContent = blk.name;
            if ((note && blk.id === note.blk) || (!note && blk.id === this.currentBlock)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Fill form if editing
        if (note) {
            if (titleInput) titleInput.value = note.title || '';
            if (contentInput) contentInput.value = note.content || '';
        } else {
            if (titleInput) titleInput.value = '';
            if (contentInput) contentInput.value = '';
        }

        this.openModal('noteModal');
    }

    async saveNote(e) {
        e.preventDefault();

        if (!this.store.isAuthenticated()) return;

        const blk = document.getElementById('noteBlk')?.value;
        const title = document.getElementById('noteTitle')?.value?.trim();
        const content = document.getElementById('noteContent')?.value?.trim();

        if (!title) {
            this.showToast('Digite um título', 'error');
            return;
        }

        if (typeof Security !== 'undefined') {
            if (!Security.validate(title, 100) || !Security.validate(content, 10000)) {
                this.showToast('Dados inválidos', 'error');
                return;
            }
        }

        if (!this.store.vault.notes) this.store.vault.notes = [];

        if (this.editingNoteId) {
            // Update existing
            const idx = this.store.vault.notes.findIndex(n => n.id === this.editingNoteId);
            if (idx !== -1) {
                this.store.vault.notes[idx] = {
                    id: this.editingNoteId,
                    blk,
                    title,
                    content,
                    updatedAt: new Date().toISOString()
                };
            }
            this.editingNoteId = null;
            this.showToast('Anotação atualizada');
        } else {
            // Create new
            const note = {
                id: this.generateId('note'),
                blk,
                title,
                content,
                createdAt: new Date().toISOString()
            };
            this.store.vault.notes.push(note);
            this.showToast('Anotação salva');
        }

        await this.store.saveVault();
        this.loadNotes();
        this.closeModal('noteModal');
        e.target.reset();
    }

    async deleteNote(id) {
        if (!this.store.isAuthenticated()) return;

        const note = this.store.vault?.notes?.find(n => n.id === id);
        const noteTitle = note?.title || 'esta anotação';

        if (!confirm(`Excluir "${noteTitle}"?`)) return;

        this.store.vault.notes = (this.store.vault.notes || []).filter(n => n.id !== id);
        await this.store.saveVault();
        this.loadNotes();
        this.showToast('Anotação excluída');
    }

    showNoteDetail(note) {
        // Create a modal-like view for the note
        const container = document.getElementById('notesList');
        if (!container) return;

        container.innerHTML = '';

        const detailCard = document.createElement('div');
                detailCard.style.cssText = 'background:var(--card-bg);border-radius:12px;padding:24px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';

        const title = document.createElement('h2');
        title.textContent = note.title;
        title.style.margin = '0';

        const backBtn = document.createElement('button');
        backBtn.className = 'btn btn-secondary';
        backBtn.textContent = '← Voltar';
        backBtn.addEventListener('click', () => this.loadNotes());

        header.appendChild(title);
        header.appendChild(backBtn);

        const content = document.createElement('div');
        content.className = 'note-content';
        content.style.cssText = 'white-space:pre-wrap;line-height:1.6;color:var(--txt-pri);';
        content.textContent = note.content;

        const meta = document.createElement('div');
        meta.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid var(--border);font-size:12px;color:var(--txt-sec);';

        if (note.createdAt) {
            const created = new Date(note.createdAt).toLocaleString('pt-BR');
            meta.innerHTML = `Criado em: ${created}`;
        }
        if (note.updatedAt) {
            const updated = new Date(note.updatedAt).toLocaleString('pt-BR');
            meta.innerHTML += `<br>Atualizado em: ${updated}`;
        }

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:12px;margin-top:20px;';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-primary';
        editBtn.textContent = '✏ Editar';
        editBtn.addEventListener('click', () => this.openNoteModal(note));

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = ' Copiar';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(note.content)
                .then(() => this.showToast('Conteúdo copiado!'))
                .catch(() => this.showToast('Erro ao copiar', 'error'));
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.textContent = '🗑 Excluir';
        delBtn.addEventListener('click', () => {
            this.deleteNote(note.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(delBtn);

        detailCard.appendChild(header);
        detailCard.appendChild(content);
        detailCard.appendChild(meta);
        detailCard.appendChild(actions);

        container.appendChild(detailCard);
    }

    // ==================== CONFIGURATION ====================

    saveConfig() {
        const svcInput = document.querySelector('input[name="emailSvc"]:checked');

        if (!svcInput) {
            this.showToast('Selecione um serviço de email', 'error');
            return;
        }

        if (!this.store.config) this.store.config = {};
        this.store.config.emailSvc = svcInput.value;

        this.store.saveConfig();
        this.closeModal('configModal');
        this.showToast('Configurações salvas');
    }

    loadConfig() {
        const config = this.store.config || {};

        // Set email service radio
        const emailSvc = config.emailSvc || 'tuamae';
        const radio = document.querySelector(`input[name="emailSvc"][value="${emailSvc}"]`);
        if (radio) radio.checked = true;
    }

    // ==================== MODAL MANAGEMENT ====================

    openModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;

        // Load config when opening config modal
        if (id === 'configModal') {
            this.loadConfig();
        }

        modal.style.display = 'flex';

        // Trigger animation
        requestAnimationFrame(() => {
            modal.classList.add('active');
        });

        // Focus first input
        const firstInput = modal.querySelector('input:not([type="hidden"]), textarea, select');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }

        // Add escape key listener
        this.modalEscapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeModal(id);
            }
        };
        document.addEventListener('keydown', this.modalEscapeHandler);
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;

        // Reset editing states
        if (id === 'noteModal') {
            this.editingNoteId = null;
            const form = document.getElementById('noteForm');
            if (form) form.reset();
        }

        if (id === 'pwdModal') {
            this.editingPasswordId = null;
            const form = document.getElementById('pwdForm');
            if (form) form.reset();
        }

        // Remove escape key listener
        if (this.modalEscapeHandler) {
            document.removeEventListener('keydown', this.modalEscapeHandler);
            this.modalEscapeHandler = null;
        }

        modal.classList.remove('active');

        // Wait for animation then hide
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }

    // ==================== TOAST NOTIFICATIONS ====================

    showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const toastMsg = document.getElementById('toastMsg');

        if (!toast || !toastMsg) return;

        // Clear any existing timeout
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }

        toastMsg.textContent = msg;
        toast.className = `toast show ${type}`;

        this.toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // ==================== UTILITY FUNCTIONS ====================

    generateId(prefix = 'id') {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 11);
        return `${prefix}_${timestamp}_${random}`;
    }

    sanitizeString(str, maxLength = 1000) {
        if (typeof str !== 'string') return '';
        return str.substring(0, maxLength).trim();
    }

    // ==================== SEARCH FUNCTIONALITY ====================

    searchPasswords(query) {
        if (!this.store.isAuthenticated() || !query) {
            this.loadPasswords();
            return;
        }

        const normalizedQuery = query.toLowerCase().trim();
        const container = document.getElementById('pwdList');
        if (!container) return;

        const allPwds = this.store.vault?.pwds || [];
        const filtered = allPwds.filter(p => {
            return (
                p.site?.toLowerCase().includes(normalizedQuery) ||
                p.usr?.toLowerCase().includes(normalizedQuery)
            );
        });

        if (filtered.length === 0) {
            container.innerHTML = `<p style="text-align:center;color:var(--txt-sec)">Nenhum resultado para "${query}"</p>`;
            return;
        }

        // Temporarily override currentBlock filter and render
        const originalBlock = this.currentBlock;
        this.currentBlock = null; // Show all blocks in search

        container.innerHTML = '';
        filtered.forEach(pwd => {
            // Render similar to loadPasswords but show block name
            const card = this.createPasswordCard(pwd, true);
            container.appendChild(card);
        });

        this.currentBlock = originalBlock;
    }

    createPasswordCard(pwd, showBlock = false) {
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

        if (showBlock) {
            const blockName = this.store.vault?.blks?.find(b => b.id === pwd.blk)?.name || 'Geral';
            const blockBadge = document.createElement('span');
            blockBadge.style.cssText = 'font-size:11px;background:var(--accent);color:white;padding:2px 6px;border-radius:4px;margin-left:8px;';
            blockBadge.textContent = blockName;
            site.appendChild(blockBadge);
        }

        const expandBtn = document.createElement('button');
        expandBtn.className = 'btn btn-expand';
        expandBtn.textContent = 'Ver Mais';

        header.appendChild(info);
        header.appendChild(expandBtn);

        const details = document.createElement('div');
        details.className = 'pwd-details';
        details.id = `pwd-${pwd.id}`;

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
        showBtn.textContent = '👁';
        showBtn.title = 'Mostrar/ocultar senha';
        showBtn.addEventListener('click', () => this.togglePasswordVisibility(pwd.id));

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-icon';
        copyBtn.textContent = '📋';
        copyBtn.title = 'Copiar senha';
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

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => this.openPasswordModal(pwd));

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.textContent = 'Excluir';
        delBtn.addEventListener('click', () => this.deletePassword(pwd.id));

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        details.appendChild(field);
        details.appendChild(actions);

        header.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                details.classList.toggle('show');
                expandBtn.textContent = details.classList.contains('show') ? 'Ver Menos' : 'Ver Mais';
            }
        });

        expandBtn.addEventListener('click', () => {
            details.classList.toggle('show');
            expandBtn.textContent = details.classList.contains('show') ? 'Ver Menos' : 'Ver Mais';
        });

        card.appendChild(header);
        card.appendChild(details);

        return card;
    }

    // ==================== DATA VALIDATION ====================

    validateVaultStructure() {
        if (!this.store.vault) {
            this.store.vault = {};
        }

        if (!Array.isArray(this.store.vault.blks)) {
            this.store.vault.blks = [{ id: 'default', name: 'Geral' }];
        }

        if (!this.store.vault.blks.find(b => b.id === 'default')) {
            this.store.vault.blks.unshift({ id: 'default', name: 'Geral' });
        }

        if (!Array.isArray(this.store.vault.pwds)) {
            this.store.vault.pwds = [];
        }

        if (!Array.isArray(this.store.vault.notes)) {
            this.store.vault.notes = [];
        }

        if (!Array.isArray(this.store.vault.prs)) {
            this.store.vault.prs = [];
        }
    }

    // ==================== KEYBOARD SHORTCUTS ====================

    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Only when not in input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Ctrl/Cmd + N - New password
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.checkAuthAndDo(() => this.openPasswordModal());
            }

            // Ctrl/Cmd + G - Generate password
            if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
                e.preventDefault();
                this.generatePassword();
            }

            // Ctrl/Cmd + L - Lock/Logout
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                this.logout();
            }
        });
    }

    // ==================== CLEANUP ====================

    destroy() {
        this.stopSessionTimer();

        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }

        if (this.modalEscapeHandler) {
            document.removeEventListener('keydown', this.modalEscapeHandler);
        }

        this.store.lock();
        this.currentPerson = null;
        this.pendingAction = null;
        this.editingNoteId = null;
        this.editingPasswordId = null;
    }
}

// ==================== SECURITY HELPER CLASS ====================

class Security {
    static rateLimits = {};

    static checkRate(action, maxAttempts = 5, windowMs = 60000) {
        const now = Date.now();
        const key = action;

        if (!this.rateLimits[key]) {
            this.rateLimits[key] = { attempts: [], blockedUntil: 0 };
        }

        const limit = this.rateLimits[key];

        // Check if currently blocked
        if (limit.blockedUntil > now) {
            return false;
        }

        // Clean old attempts
        limit.attempts = limit.attempts.filter(t => t > now - windowMs);

        // Check if too many attempts
        if (limit.attempts.length >= maxAttempts) {
            limit.blockedUntil = now + windowMs;
            return false;
        }

        // Record this attempt
        limit.attempts.push(now);
        return true;
    }

    static validate(input, maxLength = 1000) {
        if (typeof input !== 'string') return false;
        if (input.length > maxLength) return false;

        // Check for null bytes and other problematic characters
        if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(input)) {
            return false;
        }

        return true;
    }

    static sanitize(input, maxLength = 1000) {
        if (typeof input !== 'string') return '';

        return input
            .substring(0, maxLength)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .trim();
    }

    static clearRateLimits() {
        this.rateLimits = {};
    }
}

// ==================== INITIALIZE APP ====================

let app;

document.addEventListener('DOMContentLoaded', () => {
    // Check for required APIs
    if (!window.crypto || !window.crypto.subtle) {
        alert('Seu navegador não suporta as APIs de criptografia necessárias. Por favor, use um navegador moderno.');
        return;
    }

    // Check for localStorage
    if (!window.localStorage) {
        alert('Seu navegador não suporta localStorage. Por favor, habilite cookies e armazenamento local.');
        return;
    }

    // Initialize app
    try {
        app = new App();

        // Initialize keyboard shortcuts
        app.initKeyboardShortcuts();

        // Validate vault structure after initialization
        if (app.store.isAuthenticated()) {
            app.validateVaultStructure();
        }

    } catch (err) {
        console.error('Failed to initialize app:', err);
        alert('Erro ao inicializar o aplicativo. Verifique o console para mais detalhes.');
    }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (app) {
        app.destroy();
    }
});

// Handle visibility change - pause timer when hidden
document.addEventListener('visibilitychange', () => {
    if (app) {
        if (document.hidden) {
            // Page is hidden - timer continues but we don't update UI
        } else {
            // Page is visible again - update timer immediately
            app.updateSessionTimer();
        }
    }
});

        detailCard.className = 'note-detail';
