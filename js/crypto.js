'use strict';

/**
 * Crypto Module
 * Operações de criptografia usando Web Crypto API
 */
const Crypto = {
    // Configurações de segurança
    PBKDF2_ITERATIONS: 300000,  // 300k iterações
    SALT_LENGTH: 32,
    IV_LENGTH: 16,
    TAG_LENGTH: 128,
    
    /**
     * Verifica se Web Crypto está disponível
     */
    isSupported() {
        return typeof crypto !== 'undefined' && 
               crypto.subtle && 
               typeof crypto.subtle.encrypt === 'function';
    },
    
    /**
     * Gera salt aleatório seguro
     */
    generateSalt() {
        return crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    },
    
    /**
     * Deriva chave da senha usando PBKDF2
     * A senha é imediatamente descartada após derivação
     */
    async deriveKey(password, salt) {
        // Validações de entrada
        if (!password || typeof password !== 'string') {
            throw new Error('Password inválida');
        }
        if (!salt || salt.length < this.SALT_LENGTH) {
            throw new Error('Salt inválido');
        }
        
        const enc = new TextEncoder();
        const passwordBuffer = enc.encode(password);
        
        // Importa senha como chave
        const baseKey = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );
        
        // Deriva chave AES
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,  // Não exportável
            ['encrypt', 'decrypt']
        );
        
        // Limpa buffer da senha - CORRIGIDO
        if (typeof Security !== 'undefined' && Security.zeroize) {
            Security.zeroize(passwordBuffer);
        } else {
            passwordBuffer.fill(0);
        }
        
        return key;
    },
    
    /**
     * Criptografa dados com AES-GCM
     * Usa IV único e AAD para integridade
     */
    async encrypt(data, key) {
        const enc = new TextEncoder();
        const plaintext = enc.encode(JSON.stringify(data));
        
        // IV aleatório único
        const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
        
        // Additional Authenticated Data - MELHORADO
        const aadData = {
            version: 'VAULT_V1',
            timestamp: Date.now(),
            context: 'encryption'
        };
        const aad = enc.encode(JSON.stringify(aadData));
        
        // Criptografa
        const ciphertext = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                additionalData: aad,
                tagLength: this.TAG_LENGTH
            },
            key,
            plaintext
        );
        
        // Retorna tudo necessário para descriptografar
        return {
            iv: Array.from(iv),
            aad: Array.from(aad),
            data: Array.from(new Uint8Array(ciphertext))
        };
    },
    
    /**
     * Descriptografa dados com AES-GCM
     * Valida integridade via AAD
     */
    async decrypt(encryptedData, key) {
        if (!encryptedData || !encryptedData.iv || !encryptedData.data) {
            return null;
        }
        
        try {
            const iv = new Uint8Array(encryptedData.iv);
            const aad = new Uint8Array(encryptedData.aad || []);
            const ciphertext = new Uint8Array(encryptedData.data);
            
            const plaintext = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv,
                    additionalData: aad,
                    tagLength: this.TAG_LENGTH
                },
                key,
                ciphertext
            );
            
            const dec = new TextDecoder();
            return JSON.parse(dec.decode(plaintext));
        } catch (e) {
            // Falha na descriptografia ou validação
            return null;
        }
    }
};
