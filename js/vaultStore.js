'use strict';

/**
 * VaultStore Module
 * Gerencia armazenamento e criptografia do vault
 */
class VaultStore {
    constructor() {
        this.currentKey = null;  // Chave temporária em memória
        this.vault = null;       // Dados descriptografados temporários
        this.salt = null;
        this.authExpiry = 0;
        this.config = { emailSvc: 'tuamae' };
        
        // Tenta restaurar sessão do localStorage se ainda válida
        this.restoreSession();
    }
    
    /**
     * Restaura sessão do localStorage se ainda válida
     */
    restoreSession() {
        try {
            const savedExpiry = localStorage.getItem('sessionExpiry');
            if (savedExpiry) {
                const expiry = parseInt(savedExpiry, 10);
                if (expiry > Date.now()) {
                    // Sessão ainda válida, restaura expiry
                    this.authExpiry = expiry;
                } else {
                    // Sessão expirada, remove
                    localStorage.removeItem('sessionExpiry');
                }
            }
        } catch (e) {
            // Ignora erros ao restaurar sessão
        }
    }
    
    /**
     * Salva expiry da sessão no localStorage
     */
    saveSessionExpiry() {
        try {
            if (this.authExpiry > Date.now()) {
                localStorage.setItem('sessionExpiry', this.authExpiry.toString());
            } else {
                localStorage.removeItem('sessionExpiry');
            }
        } catch (e) {
            // Ignora erros ao salvar sessão
        }
    }
    
    /**
     * Cria novo vault
     */
    async createVault(password, sessionDuration = 60000) {
        // Gera salt aleatório
        this.salt = crypto.getRandomValues(new Uint8Array(Crypto.SALT_LENGTH));
        
        // Deriva chave (senha é descartada)
        this.currentKey = await Crypto.deriveKey(password, this.salt);
        
        // Estrutura inicial com blocos default
        // Todas as anotações de payloads vão para o bloco "Geral" (default)
        const allPentestNotes = [
            ...XSSPayloads.map((payload, index) => ({
                id: `note_xss_${index}_${Date.now()}`,
                blk: 'default',
                title: payload.title,
                content: payload.content
            })),
            ...SQLiPayloads.map((payload, index) => ({
                id: `note_sqli_${index}_${Date.now()}`,
                blk: 'default',
                title: payload.title,
                content: payload.content
            })),
            ...PentestPayloads.map((payload, index) => ({
                id: `note_pentest_${index}_${Date.now()}`,
                blk: 'default',
                title: payload.title,
                content: payload.content
            }))
        ];
        
        this.vault = {
            version: 1,
            blks: [
                { id: 'default', name: 'Geral' }
            ],
            pwds: [],
            prs: [],
            notes: allPentestNotes
        };
        
        // Salva criptografado
        await this.saveVault();
        
        // Define expiração da autenticação (padrão 1 minuto, ou 30 minutos se extendido)
        this.authExpiry = Date.now() + sessionDuration;
        this.saveSessionExpiry();
        
        return true;
    }
    
    /**
     * Abre vault existente
     * Testa descriptografia para validar senha
     */
    async openVault(password, sessionDuration = 60000) {
        const stored = localStorage.getItem('vault');
        if (!stored) return false;
        
        try {
            const vaultData = JSON.parse(stored);
            this.salt = new Uint8Array(vaultData.salt);
            
            // Deriva chave
            const testKey = await Crypto.deriveKey(password, this.salt);
            
            // Tenta descriptografar para validar senha
            const decrypted = await Crypto.decrypt(vaultData.data, testKey);
            
            if (!decrypted) {
                // Senha incorreta ou dados corrompidos
                return false;
            }
            
            // Sucesso - mantém chave e dados
            this.currentKey = testKey;
            this.vault = decrypted;
            this.authExpiry = Date.now() + sessionDuration;
            this.saveSessionExpiry();
            
            // Remove blocos antigos de pentest (xss, sqli, pentest) se existirem
            const pentestBlockIds = ['xss', 'sqli', 'pentest'];
            if (this.vault.blks) {
                this.vault.blks = this.vault.blks.filter(b => !pentestBlockIds.includes(b.id));
            }
            
            // Garante que o bloco "Geral" (default) existe
            const existingBlockIds = this.vault.blks ? this.vault.blks.map(b => b.id) : [];
            if (!existingBlockIds.includes('default')) {
                if (!this.vault.blks) {
                    this.vault.blks = [];
                }
                this.vault.blks.push({ id: 'default', name: 'Geral' });
            }
            
            // Remove todas as senhas dos blocos de pentest antigos (dados incorretos)
            if (this.vault.pwds && this.vault.pwds.length > 0) {
                this.vault.pwds = this.vault.pwds.filter(p => !pentestBlockIds.includes(p.blk));
            }
            
            // Migra anotações antigas dos blocos de pentest para o bloco "Geral"
            if (!this.vault.notes) {
                this.vault.notes = [];
            }
            
            // Atualiza bloco de anotações antigas dos blocos de pentest para "default"
            this.vault.notes.forEach(note => {
                if (pentestBlockIds.includes(note.blk)) {
                    note.blk = 'default';
                }
            });
            
            // Remove anotações padrão antigas que podem ter IDs duplicados
            // Remove anotações que começam com note_xss_, note_sqli_, note_pentest_
            const timestamp = Date.now();
            const existingNoteIds = this.vault.notes.map(n => n.id);
            this.vault.notes = this.vault.notes.filter(n => {
                // Mantém apenas anotações que não são payloads padrão antigos
                return !n.id.match(/^note_(xss|sqli|pentest)_\d+_/);
            });
            
            // Cria todas as anotações de payloads no bloco "Geral" (default)
            const allPentestNotes = [
                ...XSSPayloads.map((payload, index) => ({
                    id: `note_xss_${index}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
                    blk: 'default',
                    title: payload.title,
                    content: payload.content
                })),
                ...SQLiPayloads.map((payload, index) => ({
                    id: `note_sqli_${index}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
                    blk: 'default',
                    title: payload.title,
                    content: payload.content
                })),
                ...PentestPayloads.map((payload, index) => ({
                    id: `note_pentest_${index}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
                    blk: 'default',
                    title: payload.title,
                    content: payload.content
                }))
            ];
            
            // Adiciona apenas anotações que não existem ainda (verifica por título para evitar duplicatas)
            const existingTitles = new Set(this.vault.notes.map(n => n.title));
            allPentestNotes.forEach(note => {
                if (!existingTitles.has(note.title)) {
                    this.vault.notes.push(note);
                    existingTitles.add(note.title);
                }
            });
            
            // Salva as alterações
            await this.saveVault();
            
            // Carrega configurações
            const cfg = localStorage.getItem('config');
            if (cfg) {
                try {
                    this.config = JSON.parse(cfg);
                } catch {}
            }
            
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Re-autentica testando descriptografia
     * Nunca compara senhas diretamente
     */
    async reAuthenticate(password) {
        if (!this.salt) return false;
        
        try {
            // Deriva nova chave
            const testKey = await Crypto.deriveKey(password, this.salt);
            
            // Pega dados salvos
            const stored = localStorage.getItem('vault');
            if (!stored) return false;
            
            const vaultData = JSON.parse(stored);
            
            // Testa descriptografia
            const decrypted = await Crypto.decrypt(vaultData.data, testKey);
            
            if (!decrypted) {
                return false;
            }
            
            // Sucesso - atualiza chave e expiry (mantém duração padrão de 1 minuto para re-auth)
            this.currentKey = testKey;
            this.authExpiry = Date.now() + 60000;
            this.saveSessionExpiry();
            
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Salva vault criptografado
     */
    async saveVault() {
        if (!this.currentKey || !this.vault) return false;
        
        try {
            const encrypted = await Crypto.encrypt(this.vault, this.currentKey);
            
            localStorage.setItem('vault', JSON.stringify({
                salt: Array.from(this.salt),
                data: encrypted,
                timestamp: Date.now()
            }));
            
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Verifica se vault existe
     */
    exists() {
        return localStorage.getItem('vault') !== null;
    }
    
    /**
     * Verifica se autenticação ainda é válida
     */
    isAuthenticated() {
        return this.currentKey !== null && Date.now() < this.authExpiry;
    }
    
    /**
     * Retorna tempo restante da sessão em milissegundos
     */
    getSessionTimeRemaining() {
        if (!this.currentKey || !this.authExpiry) {
            return 0;
        }
        const remaining = this.authExpiry - Date.now();
        return remaining > 0 ? remaining : 0;
    }
    
    /**
     * Prolonga a sessão adicionando tempo
     * @param {number} additionalMinutes - Minutos adicionais para prolongar a sessão
     */
    extendSession(additionalMinutes = 30) {
        if (!this.isAuthenticated()) {
            return false;
        }
        
        const additionalMs = additionalMinutes * 60 * 1000;
        const currentRemaining = this.getSessionTimeRemaining();
        const newExpiry = Date.now() + currentRemaining + additionalMs;
        
        // Limita a sessão máxima a 60 minutos
        const maxSessionMs = 60 * 60 * 1000;
        this.authExpiry = Math.min(newExpiry, Date.now() + maxSessionMs);
        this.saveSessionExpiry();
        
        return true;
    }
    
    /**
     * Limpa dados sensíveis da memória
     */
    lock() {
        this.currentKey = null;
        Security.zeroize(this.vault);
        this.vault = null;
        this.authExpiry = 0;
        localStorage.removeItem('sessionExpiry');
    }
    
    /**
     * Verifica se há sessão válida salva (sem precisar descriptografar)
     */
    hasValidSession() {
        try {
            const savedExpiry = localStorage.getItem('sessionExpiry');
            if (savedExpiry) {
                const expiry = parseInt(savedExpiry, 10);
                return expiry > Date.now();
            }
        } catch (e) {
            // Ignora erros
        }
        return false;
    }
    
    /**
     * Salva configurações (não criptografadas)
     */
    saveConfig() {
        localStorage.setItem('config', JSON.stringify(this.config));
    }
}


