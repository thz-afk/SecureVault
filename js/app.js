'use strict';

/**
 * Application Controller
 * Gerencia toda a lógica da aplicação
 */
class App {
    constructor() {
        this.store = new VaultStore();
        this.currentBlock = 'default';
        this.pendingAction = null;
        this.editingNoteId = null;
        this.sessionTimerInterval = null;
        
        this.init();
    }
    
    /**
     * Inicializa aplicação
     */
    init() {
        this.attachEventListeners();
        
        if (this.store.exists()) {
            // Verifica se há sessão válida salva
            if (this.store.hasValidSession()) {
                // Sessão ainda válida, mas precisa descriptografar
                // Mostra mensagem indicando que pode continuar
                this.showLoginWithSession();
            } else {
                this.showLogin();
            }
        } else {
            this.showRegister();
        }
    }
    
    /**
     * Mostra tela de login com indicação de sessão ativa
     */
    showLoginWithSession() {
        const msg = document.getElementById('authMsg');
        if (msg) {
            msg.textContent = 'Sessão ainda ativa. Digite sua senha para continuar.';
        }
        this.showLogin();
    }
    
    /**
     * Anexa todos event listeners
     * Evita inline handlers para CSP
     */
    attachEventListeners() {
        // Auth form
        const authForm = document.getElementById('authForm');
        if (authForm) {
            authForm.addEventListener('submit', (e) => this.handleAuth(e));
        }
        
        // Re-auth form
        const reauthForm = document.getElementById('reauthForm');
        if (reauthForm) {
            reauthForm.addEventListener('submit', (e) => this.handleReAuth(e));
        }
        
        // Menu items
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => this.switchSection(e));
        });
        
        // Buttons
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
        
        // Inicializa timer de sessão
        this.startSessionTimer();
        
        // Modal close buttons
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
    
    /**
     * Mostra tela de login
     */
    showLogin() {
        const authMsg = document.getElementById('authMsg');
        const authBtnTxt = document.getElementById('authBtnTxt');
        const confirmGroup = document.getElementById('confirmGroup');
        
        if (authMsg) authMsg.textContent = 'Digite sua senha mestre para acessar';
        if (authBtnTxt) authBtnTxt.textContent = 'Entrar';
        if (confirmGroup) confirmGroup.style.display = 'none';
    }
    
    /**
     * Mostra tela de registro
     */
    showRegister() {
        const authMsg = document.getElementById('authMsg');
        const authBtnTxt = document.getElementById('authBtnTxt');
        const confirmGroup = document.getElementById('confirmGroup');
        
        if (authMsg) authMsg.textContent = 'Crie uma senha mestre para proteger seus dados';
        if (authBtnTxt) authBtnTxt.textContent = 'Criar Senha';
        if (confirmGroup) confirmGroup.style.display = 'block';
    }
    
    /**
     * Processa autenticação
     */
    async handleAuth(e) {
        e.preventDefault();
        
        // Rate limiting
        if (!Security.checkRate('auth')) {
            this.showToast('Muitas tentativas. Aguarde 1 minuto.', 'error');
            return;
        }
        
        const passwordInput = document.getElementById('masterPwd');
        const confirmInput = document.getElementById('confirmPwd');
        const btn = document.getElementById('authBtn');
        
        const password = passwordInput.value;
        const confirm = confirmInput ? confirmInput.value : '';
        
        // Validação
        if (!Security.validate(password, 128)) {
            this.showToast('Senha contém caracteres inválidos', 'error');
            return;
        }
        
        // Desabilita botão durante processamento
        btn.disabled = true;
        
        try {
            // Verifica se sessão deve ser estendida (30 minutos)
            const extendSession = document.getElementById('extendSession');
            let sessionDuration = extendSession && extendSession.checked ? 1800000 : 60000; // 30 minutos ou 1 minuto
            
            // Se já há sessão válida, preserva o tempo restante
            if (this.store.hasValidSession()) {
                const remaining = this.store.getSessionTimeRemaining();
                if (remaining > 0) {
                    // Usa o tempo restante + nova duração escolhida
                    sessionDuration = remaining + (extendSession && extendSession.checked ? 1800000 : 60000);
                }
            }
            
            if (this.store.exists()) {
                // Login
                const success = await this.store.openVault(password, sessionDuration);
                
                if (success) {
                    this.enterDashboard();
                } else {
                    this.showToast('Senha incorreta', 'error');
                }
            } else {
                // Registro
                if (password !== confirm) {
                    this.showToast('Senhas não coincidem', 'error');
                    return;
                }
                
                await this.store.createVault(password, sessionDuration);
                this.enterDashboard();
            }
        } finally {
            // Limpa campos e reabilita botão
            passwordInput.value = '';
            if (confirmInput) confirmInput.value = '';
            btn.disabled = false;
        }
    }
    
    /**
     * Processa re-autenticação
     */
    async handleReAuth(e) {
        e.preventDefault();
        
        if (!Security.checkRate('reauth')) {
            this.showToast('Muitas tentativas. Aguarde.', 'error');
            return;
        }
        
        const passwordInput = document.getElementById('authPwd');
        const password = passwordInput.value;
        
        if (!Security.validate(password, 128)) {
            this.showToast('Senha inválida', 'error');
            return;
        }
        
        const success = await this.store.reAuthenticate(password);
        
        if (success) {
            this.closeModal('authModal');
            
            // Executa ação pendente
            if (this.pendingAction) {
                this.pendingAction();
                this.pendingAction = null;
            }
            
            this.showToast('Autenticado', 'success');
        } else {
            this.showToast('Senha incorreta', 'error');
        }
        
        passwordInput.value = '';
    }
    
    /**
     * Entra no dashboard
     */
    enterDashboard() {
        // Verifica autenticação antes de entrar no dashboard
        if (!this.store.isAuthenticated()) {
            this.showToast('Autenticação necessária', 'error');
            return;
        }
        
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        
        // Inicia timer de sessão
        this.startSessionTimer();
        
        this.showToast('Bem-vindo!', 'success');
    }
    
    /**
     * Inicia timer de sessão
     */
    startSessionTimer() {
        // Limpa timer anterior se existir
        if (this.sessionTimerInterval) {
            clearInterval(this.sessionTimerInterval);
        }
        
        // Atualiza imediatamente
        this.updateSessionTimer();
        
        // Atualiza a cada segundo
        this.sessionTimerInterval = setInterval(() => {
            this.updateSessionTimer();
        }, 1000);
    }
    
    /**
     * Atualiza display do timer de sessão
     */
    updateSessionTimer() {
        const timerDisplay = document.getElementById('timerDisplay');
        const extendBtn = document.getElementById('extendSessionBtn');
        const sessionTimer = document.getElementById('sessionTimer');
        
        if (!timerDisplay || !extendBtn || !sessionTimer) return;
        
        if (!this.store.isAuthenticated()) {
            timerDisplay.textContent = 'Expirada';
            timerDisplay.style.color = 'var(--danger)';
            extendBtn.disabled = true;
            return;
        }
        
        const remaining = this.store.getSessionTimeRemaining();
        
        if (remaining <= 0) {
            timerDisplay.textContent = 'Expirada';
            timerDisplay.style.color = 'var(--danger)';
            extendBtn.disabled = true;
            return;
        }
        
        // Calcula minutos e segundos
        const totalSeconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        // Formata como MM:SS
        const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        timerDisplay.textContent = formatted;
        
        // Muda cor se estiver abaixo de 1 minuto
        if (totalSeconds < 60) {
            timerDisplay.style.color = 'var(--danger)';
        } else if (totalSeconds < 300) { // Menos de 5 minutos
            timerDisplay.style.color = 'var(--warn)';
        } else {
            timerDisplay.style.color = 'var(--txt-sec)';
        }
        
        extendBtn.disabled = false;
    }
    
    /**
     * Prolonga sessão em 30 minutos
     */
    extendSession() {
        // Verifica autenticação antes de prolongar
        if (!this.store.isAuthenticated()) {
            this.showToast('Sessão expirada. Faça login novamente.', 'error');
            return;
        }
        
        const success = this.store.extendSession(30);
        
        if (success) {
            this.showToast('Sessão prolongada em 30 minutos', 'success');
            this.updateSessionTimer();
        } else {
            this.showToast('Não foi possível prolongar a sessão', 'error');
        }
    }
    
    /**
     * Limpa interface quando autenticação expira
     */
    clearInterfaceOnExpiry() {
        // Limpa dados sensíveis da interface
        const pwdList = document.getElementById('pwdList');
        if (pwdList) {
            pwdList.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação expirada</p>';
        }
        
        const notesList = document.getElementById('notesList');
        if (notesList) {
            notesList.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação expirada</p>';
        }
        
        const blkList = document.getElementById('blkList');
        if (blkList) {
            blkList.innerHTML = '';
        }
    }
    
    /**
     * Verifica autenticação antes de ação sensível
     */
    checkAuthAndDo(action) {
        if (this.store.isAuthenticated()) {
            action();
        } else {
            this.pendingAction = action;
            this.openModal('authModal');
        }
    }
    
    /**
     * Logout
     */
    logout() {
        if (confirm('Deseja sair?')) {
            // Limpa timer de sessão
            if (this.sessionTimerInterval) {
                clearInterval(this.sessionTimerInterval);
                this.sessionTimerInterval = null;
            }
            
            this.store.lock();
            location.reload();
        }
    }
    
    /**
     * Troca seção ativa
     */
    switchSection(e) {
        const section = e.currentTarget.dataset.section;
        if (!section) return;
        
        // Verifica autenticação antes de trocar de seção (exceto para seções não sensíveis)
        const sensitiveSections = ['passwords', 'notes'];
        if (sensitiveSections.includes(section) && !this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.switchSection(e));
            return;
        }
        
        // Atualiza menu
        document.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('active');
        });
        e.currentTarget.classList.add('active');
        
        // Atualiza conteúdo
        document.querySelectorAll('.section').forEach(sec => {
            sec.classList.remove('active');
        });
        
        const targetSection = document.getElementById(section);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        // Recarrega dados se necessário e autenticado
        if (this.store.isAuthenticated()) {
            if (section === 'passwords') {
                this.loadPasswords();
            } else if (section === 'notes') {
                this.loadNotes();
            }
        }
    }
    
    /**
     * Carrega lista de blocos
     */
    loadBlocks() {
        // Verifica autenticação antes de carregar blocos
        if (!this.store.isAuthenticated()) {
            const container = document.getElementById('blkList');
            if (container) {
                container.innerHTML = '';
            }
            return;
        }
        
        const container = document.getElementById('blkList');
        if (!container || !this.store.vault) return;
        
        // Limpa container
        container.innerHTML = '';
        
        this.store.vault.blks.forEach(block => {
            const div = document.createElement('div');
            div.className = `blk-item ${block.id === this.currentBlock ? 'active' : ''}`;
            
            // Evento de clique na div inteira para melhor hitbox
            div.style.cursor = 'pointer';
            div.addEventListener('click', (e) => {
                // Previne clique se for no botão de deletar
                if (e.target.tagName === 'BUTTON') {
                    return;
                }
                this.selectBlock(block.id);
            });
            
            const span = document.createElement('span');
            span.textContent = block.name; // textContent previne XSS
            
            div.appendChild(span);
            
            // Botão deletar (exceto default)
            if (block.id !== 'default') {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon';
                delBtn.style.padding = '4px';
                delBtn.textContent = '✕';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Previne propagação para a div
                    this.deleteBlock(block.id);
                });
                div.appendChild(delBtn);
            }
            
            container.appendChild(div);
        });
    }
    
    /**
     * Seleciona bloco
     */
    selectBlock(id) {
        // Verifica autenticação antes de trocar de bloco
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.selectBlock(id));
            return;
        }
        
        this.currentBlock = id;
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
    }
    
    /**
     * Salva novo bloco
     */
    async saveBlock(e) {
        e.preventDefault();
        
        // Verifica autenticação antes de salvar
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => {
                const form = document.getElementById('blkForm');
                if (form) form.requestSubmit();
            });
            return;
        }
        
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
    
    /**
     * Deleta bloco
     */
    async deleteBlock(id) {
        // Verifica autenticação antes de deletar
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.deleteBlock(id));
            return;
        }
        
        // Protege bloco default
        if (id === 'default') {
            this.showToast('Não é possível excluir o bloco padrão', 'error');
            return;
        }
        
        if (!confirm('Excluir bloco e todo conteúdo?')) return;
        
        this.store.vault.blks = this.store.vault.blks.filter(b => b.id !== id);
        this.store.vault.pwds = this.store.vault.pwds.filter(p => p.blk !== id);
        this.store.vault.notes = this.store.vault.notes.filter(n => n.blk !== id);
        
        await this.store.saveVault();
        
        if (this.currentBlock === id) {
            this.currentBlock = 'default';
        }
        
        this.loadBlocks();
        this.loadPasswords();
        this.loadNotes();
        
        this.showToast('Bloco excluído');
    }
    
    /**
     * Carrega lista de senhas
     */
    loadPasswords() {
        // Verifica autenticação antes de carregar senhas
        if (!this.store.isAuthenticated()) {
            const container = document.getElementById('pwdList');
            if (container) {
                container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            }
            return;
        }
        
        const container = document.getElementById('pwdList');
        if (!container || !this.store.vault) return;
        
        const passwords = this.store.vault.pwds.filter(p => p.blk === this.currentBlock);
        
        if (passwords.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma senha salva</p>';
            return;
        }
        
        container.innerHTML = '';
        
        passwords.forEach(pwd => {
            const card = document.createElement('div');
            card.className = 'pwd-card';
            
            // Header
            const header = document.createElement('div');
            header.className = 'pwd-header';
            
            const info = document.createElement('div');
            
            const site = document.createElement('div');
            site.className = 'pwd-site';
            site.textContent = pwd.site; // textContent previne XSS
            
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
            
            const wrapper = document.createElement('div');
            wrapper.className = 'pwd-value-wrapper';
            
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
            
            wrapper.appendChild(value);
            wrapper.appendChild(showBtn);
            wrapper.appendChild(copyBtn);
            
            field.appendChild(label);
            field.appendChild(wrapper);
            
            const actions = document.createElement('div');
            actions.style.marginTop = '16px';
            actions.style.display = 'flex';
            actions.style.gap = '8px';
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.textContent = 'Excluir';
            delBtn.addEventListener('click', () => this.deletePassword(pwd.id));
            
            actions.appendChild(delBtn);
            
            details.appendChild(field);
            details.appendChild(actions);
            
            // Toggle details
            header.addEventListener('click', () => {
                details.classList.toggle('show');
            });
            
            card.appendChild(header);
            card.appendChild(details);
            container.appendChild(card);
        });
    }
    
    /**
     * Abre modal de senha
     */
    openPasswordModal() {
        const select = document.getElementById('pwdBlk');
        if (!select) return;
        
        select.innerHTML = '';
        
        this.store.vault.blks.forEach(blk => {
            const option = document.createElement('option');
            option.value = blk.id;
            option.textContent = blk.name;
            if (blk.id === this.currentBlock) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        this.openModal('pwdModal');
    }
    
    /**
     * Salva senha
     */
    async savePassword(e) {
        e.preventDefault();
        
        // Verifica autenticação antes de salvar senha
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => {
                const form = document.getElementById('pwdForm');
                if (form) form.requestSubmit();
            });
            return;
        }
        
        const blk = document.getElementById('pwdBlk').value;
        const site = document.getElementById('pwdSite').value;
        const usr = document.getElementById('pwdUsr').value;
        const val = document.getElementById('pwdVal').value;
        
        // Validação
        if (!Security.validate(site, 100) || 
            !Security.validate(usr, 200) || 
            !Security.validate(val, 500)) {
            this.showToast('Dados inválidos', 'error');
            return;
        }
        
        const pwd = {
            id: 'pwd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            blk,
            site,
            usr,
            val
        };
        
        this.store.vault.pwds.push(pwd);
        await this.store.saveVault();
        
        this.loadPasswords();
        this.closeModal('pwdModal');
        this.showToast('Senha salva');
        
        e.target.reset();
    }
    
    /**
     * Alterna visibilidade da senha
     */
    togglePasswordVisibility(id) {
        // Verifica autenticação antes de mostrar senha
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.togglePasswordVisibility(id));
            return;
        }
        
        const element = document.getElementById(`pwdval-${id}`);
        if (!element) return;
        
        const pwd = this.store.vault.pwds.find(p => p.id === id);
        if (!pwd) return;
        
        if (element.textContent === '••••••••') {
            element.textContent = pwd.val;
        } else {
            element.textContent = '••••••••';
        }
    }
    
    /**
     * Copia senha
     */
    copyPassword(id) {
        // Verifica autenticação antes de copiar senha
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.copyPassword(id));
            return;
        }
        
        const pwd = this.store.vault.pwds.find(p => p.id === id);
        if (!pwd) return;
        
        navigator.clipboard.writeText(pwd.val).then(() => {
            this.showToast('Senha copiada');
        }).catch(() => {
            this.showToast('Erro ao copiar', 'error');
        });
    }
    
    /**
     * Deleta senha
     */
    async deletePassword(id) {
        // Verifica autenticação antes de deletar senha
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.deletePassword(id));
            return;
        }
        
        if (!confirm('Excluir senha?')) return;
        
        this.store.vault.pwds = this.store.vault.pwds.filter(p => p.id !== id);
        await this.store.saveVault();
        
        this.loadPasswords();
        this.showToast('Senha excluída');
    }
    
    /**
     * Gera senha forte
     */
    generatePassword() {
        const length = parseInt(document.getElementById('genLen').value) || 16;
        const useUpper = document.getElementById('genUpper').checked;
        const useLower = document.getElementById('genLower').checked;
        const useNumbers = document.getElementById('genNum').checked;
        const useSymbols = document.getElementById('genSym').checked;
        
        let charset = '';
        if (useUpper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (useLower) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (useNumbers) charset += '0123456789';
        if (useSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        if (!charset) {
            this.showToast('Selecione pelo menos uma opção', 'error');
            return;
        }
        
        let password = '';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        
        for (let i = 0; i < length; i++) {
            password += charset[array[i] % charset.length];
        }
        
        const input = document.getElementById('genPwd');
        if (input) input.value = password;
    }
    
    /**
     * Copia senha gerada
     */
    copyGenerated() {
        const input = document.getElementById('genPwd');
        if (!input || !input.value) return;
        
        navigator.clipboard.writeText(input.value).then(() => {
            this.showToast('Copiado!');
        });
    }
    
    /**
     * Gera senha rápida
     */
    generateQuickPassword() {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        
        for (let i = 0; i < 16; i++) {
            password += charset[array[i] % charset.length];
        }
        
        const input = document.getElementById('pwdVal');
        if (input) input.value = password;
    }
    
    /**
     * Gera pessoa fictícia
     */
    generatePerson() {
        const names = [
          'Joao', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Julia', 'Lucas', 'Mariana',
          'Rafael', 'Beatriz', 'Andre', 'Fernanda', 'Gabriel', 'Larissa', 'Bruno',
          'Camila', 'Diego', 'Patricia', 'Rodrigo', 'Natalia', 'Felipe', 'Aline',
          'Gustavo', 'Isabela', 'Thiago', 'Renata', 'Eduardo', 'Carolina'
        ];

        const surnames = [
          'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Costa', 'Ferreira',
          'Gomes', 'Ribeiro', 'Almeida', 'Pereira', 'Rodrigues', 'Martins',
          'Barbosa', 'Araujo', 'Cardoso', 'Melo', 'Correia', 'Teixeira', 'Dias',
          'Nunes', 'Batista', 'Freitas', 'Vieira', 'Rocha'
        ];
        
        const name = names[Math.floor(Math.random() * names.length)] + ' ' + 
                    surnames[Math.floor(Math.random() * surnames.length)];
        
        const cpf = this.generateCPF();
        
        const year = 1950 + Math.floor(Math.random() * 50);
        const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
        const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
        const birthdate = `${day}/${month}/${year}`;
        
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
        
        const address = StreetsData[Math.floor(Math.random() * StreetsData.length)] + ', ' + 
                       Math.floor(Math.random() * 9999);
        
        const person = { name, cpf, birthdate, email, link, address };
        
        // Armazena a pessoa atual para permitir atualização do link quando o domínio do email mudar
        this.currentPerson = person;
        
        this.displayPerson(person);
    }
    
    /**
     * Gera CPF válido
     */
    generateCPF() {
        const nums = Array.from({length: 9}, () => Math.floor(Math.random() * 10));
        
        // Primeiro dígito
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += nums[i] * (10 - i);
        }
        let d1 = 11 - (sum % 11);
        if (d1 >= 10) d1 = 0;
        nums.push(d1);
        
        // Segundo dígito
        sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += nums[i] * (11 - i);
        }
        let d2 = 11 - (sum % 11);
        if (d2 >= 10) d2 = 0;
        nums.push(d2);
        
        return nums.slice(0,3).join('') + '.' + 
               nums.slice(3,6).join('') + '.' + 
               nums.slice(6,9).join('') + '-' + 
               nums.slice(9,11).join('');
    }
    
    /**
     * Exibe pessoa gerada
     */
    displayPerson(person) {
        const container = document.getElementById('personContent');
        if (!container) return;
        
        container.innerHTML = '';
        
        const card = document.createElement('div');
        card.className = 'person-card';
        
        // Campos
        const fields = [
            { label: 'Nome', value: person.name },
            { label: 'CPF', value: person.cpf },
            { label: 'Nascimento', value: person.birthdate },
            { label: 'Email', value: person.email, hasActions: true, link: person.link },
            { label: 'Endereço', value: person.address }
        ];
        
        fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'person-field';
            
            const label = document.createElement('span');
            label.className = 'field-label';
            label.textContent = field.label + ':';
            
            const valueDiv = document.createElement('span');
            valueDiv.className = 'field-value';
            
            if (field.hasActions) {
                const emailSpan = document.createElement('span');
                emailSpan.id = 'personEmail';
                emailSpan.textContent = field.value;
                
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-icon';
                editBtn.textContent = '✏';
                editBtn.addEventListener('click', () => this.changeEmailDomain());
                
                const linkBtn = document.createElement('button');
                linkBtn.className = 'btn-icon';
                linkBtn.textContent = '↗';
                linkBtn.id = 'personLinkBtn';
                linkBtn.addEventListener('click', () => {
                    // Obtém o link atualizado baseado no email exibido
                    const currentEmail = document.getElementById('personEmail').textContent;
                    const emailUser = currentEmail.split('@')[0];
                    const domain = currentEmail.split('@')[1];
                    
                    let currentLink;
                    if (domain === 'tuamaeaquelaursa.com') {
                        currentLink = `https://tuamaeaquelaursa.com/${emailUser}`;
                    } else if (domain === 'firemail.com.br') {
                        currentLink = `https://firemail.com.br/${emailUser}`;
                    } else {
                        currentLink = field.link; // Fallback para o link original
                    }
                    
                    window.open(currentLink, '_blank');
                });
                
                valueDiv.appendChild(emailSpan);
                valueDiv.appendChild(editBtn);
                valueDiv.appendChild(linkBtn);
            } else {
                valueDiv.textContent = field.value;
            }
            
            div.appendChild(label);
            div.appendChild(valueDiv);
            card.appendChild(div);
        });
        
        container.appendChild(card);
        
        // Botões
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '12px';
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary';
        saveBtn.textContent = 'Salvar Preset';
        saveBtn.addEventListener('click', () => this.savePerson(person));
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn btn-secondary';
        copyBtn.textContent = 'Copiar Dados';
        copyBtn.addEventListener('click', () => this.copyPerson(person));
        
        actions.appendChild(saveBtn);
        actions.appendChild(copyBtn);
        container.appendChild(actions);
    }
    
    /**
     * Altera domínio do email
     * Atualiza tanto o email exibido quanto o link de redirecionamento
     */
    changeEmailDomain() {
        const emailEl = document.getElementById('personEmail');
        if (!emailEl) return;
        
        const current = emailEl.textContent;
        const user = current.split('@')[0];
        
        let newEmail, newLink;
        
        if (current.includes('@tuamaeaquelaursa')) {
            newEmail = user + '@firemail.com.br';
            newLink = `https://firemail.com.br/${user}`;
        } else if (current.includes('@firemail')) {
            newEmail = user + '@tuamaeaquelaursa.com';
            newLink = `https://tuamaeaquelaursa.com/${user}`;
        } else {
            // Se não reconhecer o domínio, mantém como está
            return;
        }
        
        // Atualiza o email exibido
        emailEl.textContent = newEmail;
        
        // Atualiza o objeto person atual para manter consistência
        if (this.currentPerson) {
            this.currentPerson.email = newEmail;
            this.currentPerson.link = newLink;
        }
    }
    
    /**
     * Salva pessoa
     */
    async savePerson(person) {
        // Verifica autenticação antes de salvar pessoa
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.savePerson(person));
            return;
        }
        
        person.id = 'prs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        if (!this.store.vault.prs) {
            this.store.vault.prs = [];
        }
        
        this.store.vault.prs.push(person);
        await this.store.saveVault();
        
        this.showToast('Pessoa salva');
    }
    
    /**
     * Copia dados da pessoa
     */
    copyPerson(person) {
        const text = `Nome: ${person.name}\nCPF: ${person.cpf}\nNascimento: ${person.birthdate}\nEmail: ${person.email}\nEndereço: ${person.address}`;
        
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Dados copiados');
        });
    }
    
    /**
     * Mostra pessoas salvas
     */
    showSavedPersons() {
        // Verifica autenticação antes de mostrar pessoas salvas
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.showSavedPersons());
            return;
        }
        
        const container = document.getElementById('personContent');
        if (!container) return;
        
        if (!this.store.vault.prs || this.store.vault.prs.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma pessoa salva</p>';
            return;
        }
        
        container.innerHTML = '';
        
        this.store.vault.prs.forEach(person => {
            const card = document.createElement('div');
            card.className = 'person-card';
            
            // Campos básicos
            const fields = [
                { label: 'Nome', value: person.name },
                { label: 'CPF', value: person.cpf },
                { label: 'Nascimento', value: person.birthdate },
                { label: 'Email', value: person.email }
            ];
            
            fields.forEach(field => {
                const div = document.createElement('div');
                div.className = 'person-field';
                
                const label = document.createElement('span');
                label.className = 'field-label';
                label.textContent = field.label + ':';
                
                const value = document.createElement('span');
                value.className = 'field-value';
                value.textContent = field.value;
                
                div.appendChild(label);
                div.appendChild(value);
                card.appendChild(div);
            });
            
            // Ações
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '12px';
            actions.style.marginTop = '16px';
            
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-icon';
            copyBtn.textContent = '📋';
            copyBtn.addEventListener('click', () => this.copyPerson(person));
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', () => this.deletePerson(person.id));
            
            actions.appendChild(copyBtn);
            actions.appendChild(delBtn);
            card.appendChild(actions);
            
            container.appendChild(card);
        });
    }
    
    /**
     * Deleta pessoa
     */
    async deletePerson(id) {
        // Verifica autenticação antes de deletar pessoa
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.deletePerson(id));
            return;
        }
        
        if (!confirm('Excluir pessoa?')) return;
        
        this.store.vault.prs = this.store.vault.prs.filter(p => p.id !== id);
        await this.store.saveVault();
        
        this.showSavedPersons();
        this.showToast('Pessoa excluída');
    }
    
    /**
     * Carrega notas
     */
    loadNotes() {
        // Verifica autenticação antes de carregar notas
        if (!this.store.isAuthenticated()) {
            const container = document.getElementById('notesList');
            if (container) {
                container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Autenticação necessária</p>';
            }
            return;
        }
        
        const container = document.getElementById('notesList');
        if (!container || !this.store.vault) return;
        
        const notes = this.store.vault.notes ? 
            this.store.vault.notes.filter(n => n.blk === this.currentBlock) : [];
        
        if (notes.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--txt-sec)">Nenhuma anotação salva</p>';
            return;
        }
        
        container.innerHTML = '';
        
        notes.forEach(note => {
            const card = document.createElement('div');
            card.className = 'note-card';
            
            // Header com título e botões
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '8px';
            
            const title = document.createElement('div');
            title.className = 'note-title';
            title.textContent = note.title;
            title.style.cursor = 'pointer';
            title.style.flex = '1';
            title.addEventListener('click', () => this.showNoteDetail(note));
            
            // Botões de ação
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '8px';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-icon';
            editBtn.textContent = 'Editar';
            editBtn.title = 'Editar';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editNote(note);
            });
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon';
            delBtn.textContent = 'Apagar';
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
            preview.textContent = note.content.substring(0, 100) + '...';
            preview.style.cursor = 'pointer';
            preview.addEventListener('click', () => this.showNoteDetail(note));
            
            card.appendChild(header);
            card.appendChild(preview);
            container.appendChild(card);
        });
    }
    
    /**
     * Abre modal de nota
     */
    openNoteModal(note = null) {
        // Verifica autenticação antes de abrir modal
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.openNoteModal(note));
            return;
        }
        
        const select = document.getElementById('noteBlk');
        const titleInput = document.getElementById('noteTitle');
        const contentInput = document.getElementById('noteContent');
        const modalTitle = document.querySelector('#noteModal .modal-title');
        const form = document.getElementById('noteForm');
        
        if (!select || !titleInput || !contentInput || !form) return;
        
        // Define modo de edição ou criação
        this.editingNoteId = note ? note.id : null;
        
        // Atualiza título do modal
        if (modalTitle) {
            modalTitle.textContent = note ? 'Editar Anotação' : 'Nova Anotação';
        }
        
        // Preenche campos se estiver editando
        if (note) {
            titleInput.value = note.title;
            contentInput.value = note.content;
        } else {
            titleInput.value = '';
            contentInput.value = '';
        }
        
        // Preenche select de blocos
        select.innerHTML = '';
        this.store.vault.blks.forEach(blk => {
            const option = document.createElement('option');
            option.value = blk.id;
            option.textContent = blk.name;
            if (note && blk.id === note.blk) {
                option.selected = true;
            } else if (!note && blk.id === this.currentBlock) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        this.openModal('noteModal');
    }
    
    /**
     * Salva nota
     */
    async saveNote(e) {
        e.preventDefault();
        
        // Verifica autenticação antes de salvar nota
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => {
                const form = document.getElementById('noteForm');
                if (form) form.requestSubmit();
            });
            return;
        }
        
        const blk = document.getElementById('noteBlk').value;
        const title = document.getElementById('noteTitle').value;
        const content = document.getElementById('noteContent').value;
        
        if (!Security.validate(title, 100) || !Security.validate(content, 5000)) {
            this.showToast('Dados inválidos', 'error');
            return;
        }
        
        if (!this.store.vault.notes) {
            this.store.vault.notes = [];
        }
        
        // Verifica se é edição ou criação
        if (this.editingNoteId) {
            // Edita nota existente
            const noteIndex = this.store.vault.notes.findIndex(n => n.id === this.editingNoteId);
            if (noteIndex !== -1) {
                this.store.vault.notes[noteIndex] = {
                    id: this.editingNoteId,
                    blk,
                    title,
                    content
                };
                await this.store.saveVault();
                this.loadNotes();
                this.closeModal('noteModal');
                this.showToast('Anotação atualizada');
                this.editingNoteId = null;
                e.target.reset();
                return;
            }
        }
        
        // Cria nova nota
        const note = {
            id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            blk,
            title,
            content
        };
        
        this.store.vault.notes.push(note);
        await this.store.saveVault();
        
        this.loadNotes();
        this.closeModal('noteModal');
        this.showToast('Anotação salva');
        this.editingNoteId = null;
        
        e.target.reset();
    }
    
    /**
     * Edita nota
     */
    editNote(note) {
        this.openNoteModal(note);
    }
    
    /**
     * Deleta nota
     */
    async deleteNote(id) {
        // Verifica autenticação antes de deletar nota
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.deleteNote(id));
            return;
        }
        
        if (!confirm('Excluir anotação?')) return;
        
        this.store.vault.notes = this.store.vault.notes.filter(n => n.id !== id);
        await this.store.saveVault();
        
        this.loadNotes();
        this.showToast('Anotação excluída');
    }
    
    /**
     * Mostra detalhes da nota
     */
    showNoteDetail(note) {
        // Verifica autenticação antes de mostrar detalhes
        if (!this.store.isAuthenticated()) {
            this.checkAuthAndDo(() => this.showNoteDetail(note));
            return;
        }
        
        alert(`${note.title}\n\n${note.content}`);
    }
    
    /**
     * Salva configurações
     */
    saveConfig() {
        const service = document.querySelector('input[name="emailSvc"]:checked');
        if (!service) return;
        
        this.store.config.emailSvc = service.value;
        this.store.saveConfig();
        
        this.closeModal('configModal');
        this.showToast('Configurações salvas');
    }
    
    /**
     * Abre modal
     */
    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    }
    
    /**
     * Fecha modal
     */
    closeModal(id) {
        // Limpa estado de edição ao fechar modal de notas
        if (id === 'noteModal') {
            this.editingNoteId = null;
            const form = document.getElementById('noteForm');
            if (form) form.reset();
        }
        
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }
    
    /**
     * Mostra toast
     */
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        const msg = document.getElementById('toastMsg');
        
        if (!toast || !msg) return;
        
        msg.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

