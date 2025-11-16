'use strict';

/**
 * Security Module
 * Validação de inputs e rate limiting
 */
const Security = {
    /**
     * Valida input contra XSS e injeções
     * Bloqueia: tags HTML, javascript:, data:, eventos, etc.
     */
    validate(str, maxLen = 1000) {
        if (typeof str !== 'string') return false;
        if (str.length > maxLen) return false;
        
        // Regex para detectar tentativas de XSS
        const dangerous = [
            /<[^>]*>/gi,           // Qualquer tag HTML
            /javascript:/gi,        // javascript: protocol
            /on\w+\s*=/gi,         // Event handlers
            /data:[^,]*script/gi,  // data: URLs com script
            /<script/gi,           // Script tags
            /<iframe/gi,           // iframes
            /<object/gi,           // objects
            /<embed/gi,            // embeds
            /<img/gi,              // images (podem ter onerror)
            /<svg/gi,              // SVG (pode conter scripts)
            /eval\s*\(/gi,         // eval()
            /expression\s*\(/gi,   // CSS expressions
            /import\s+/gi,         // ES6 imports
            /require\s*\(/gi       // CommonJS requires
        ];
        
        for (const regex of dangerous) {
            if (regex.test(str)) return false;
        }
        
        return true;
    },
    
    /**
     * Rate limiting para prevenir força bruta
     */
    attempts: new Map(),
    
    checkRate(key, max = 5, window = 60000) {
        const now = Date.now();
        const attempt = this.attempts.get(key);
        
        if (!attempt || now - attempt.first > window) {
            this.attempts.set(key, { count: 1, first: now });
            return true;
        }
        
        attempt.count++;
        return attempt.count <= max;
    },
    
    /**
     * Limpa dados sensíveis da memória
     */
    zeroize(obj) {
        if (typeof obj === 'string') {
            // Strings são imutáveis em JS, melhor que podemos fazer
            obj = null;
        } else if (obj instanceof Uint8Array) {
            crypto.getRandomValues(obj); // Sobrescreve com random
            obj.fill(0); // Depois zera
        } else if (obj && typeof obj === 'object') {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.zeroize(obj[key]);
                    delete obj[key];
                }
            }
        }
    }
};

